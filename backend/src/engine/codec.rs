//! Native game domain with explicit JSON adapters for persisted/wire fixtures.
//! Live rooms call `typed` directly and retain typed state across commands.
pub use super::rng::Rng;
use super::typed;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineError {
    pub code: String,
    pub message: String,
}
impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for EngineError {}
impl From<typed::EngineError> for EngineError {
    fn from(e: typed::EngineError) -> Self {
        Self {
            code: e.code.to_string(),
            message: e.message,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineResult {
    pub state: Value,
    pub effects: Vec<Value>,
}
pub(crate) fn error(code: &str, message: impl Into<String>) -> EngineError {
    EngineError {
        code: code.into(),
        message: message.into(),
    }
}
fn decode<T: for<'de> Deserialize<'de>>(v: &Value) -> Result<T, EngineError> {
    T::deserialize(v).map_err(|e| error("INVALID_RANDOMNESS", format!("Invalid domain data: {e}")))
}
fn encode<T: Serialize>(v: T) -> Value {
    serde_json::to_value(v).expect("typed game serialization")
}
fn transition(r: typed::Transition) -> EngineResult {
    EngineResult {
        state: encode(r.state),
        effects: r.effects.into_iter().map(encode).collect(),
    }
}
pub fn create_game(input: &Value) -> Result<Value, EngineError> {
    typed::create_game(decode::<typed::CreateGame>(input)?)
        .map(encode)
        .map_err(Into::into)
}
#[cfg(feature = "legacy-import")]
pub fn create_legacy_game(input: &Value) -> Result<Value, EngineError> {
    typed::create_legacy_game(decode::<typed::CreateGame>(input)?)
        .map(encode)
        .map_err(Into::into)
}
pub fn reduce(
    state: &Value,
    event: &Value,
    now: i64,
    seed: &str,
) -> Result<EngineResult, EngineError> {
    reduce_owned(state.clone(), event, now, seed).map_err(|(e, _)| e)
}
pub fn reduce_owned(
    state: Value,
    event: &Value,
    now: i64,
    seed: &str,
) -> Result<EngineResult, (EngineError, Value)> {
    if state
        .get("randomnessVersion")
        .is_some_and(|v| v != "resolved-v1")
    {
        return Err((
            error(
                "INVALID_RANDOMNESS",
                "Missing or unsupported randomness version",
            ),
            state,
        ));
    }
    let parsed = match decode::<typed::GameState>(&state) {
        Ok(s) => s,
        Err(e) => return Err((e, state)),
    };
    let event = match decode::<typed::GameEvent>(event) {
        Ok(e) => e,
        Err(e) => return Err((e, state)),
    };
    #[cfg(feature = "legacy-import")]
    let result = if parsed.randomness_version.is_none() {
        typed::apply_legacy_owned(parsed, &event, now, seed)
    } else {
        typed::apply_owned(parsed, &event, now)
    };
    #[cfg(not(feature = "legacy-import"))]
    let result = {
        let _ = seed;
        typed::apply_owned(parsed, &event, now)
    };
    result.map(transition).map_err(|(e, _)| (e.into(), state))
}
#[cfg(feature = "legacy-import")]
pub fn reduce_legacy(
    state: &Value,
    event: &Value,
    now: i64,
    seed: &str,
) -> Result<EngineResult, EngineError> {
    if state.get("randomnessVersion").is_some() {
        return Err(error(
            "INVALID_RANDOMNESS",
            "Legacy importer requires an unversioned legacy state",
        ));
    }
    reduce(state, event, now, seed)
}
pub fn resolve_randomness(state: &Value, event: &Value, seed: &str) -> Result<Value, EngineError> {
    typed::resolve_randomness(&decode(state)?, &decode(event)?, seed)
        .map(encode)
        .map_err(Into::into)
}
pub fn project(state: &Value, viewer: &str) -> Value {
    match decode::<typed::GameState>(state) {
        Ok(s) => encode(typed::project(&s, &viewer.into())),
        Err(_) => Value::Null,
    }
}
pub fn project_many(state: &Value, viewers: &[String]) -> Vec<Value> {
    let Ok(s) = decode::<typed::GameState>(state) else {
        return vec![];
    };
    typed::project_many(
        &s,
        &viewers.iter().cloned().map(Into::into).collect::<Vec<_>>(),
    )
    .into_iter()
    .map(encode)
    .collect()
}
pub fn role_variants(state: &Value) -> Value {
    decode::<typed::GameState>(state)
        .map(|s| encode(typed::role_variants(&s)))
        .unwrap_or(json!({}))
}
pub fn weighted_roles(
    players: &Value,
    deck: &Value,
    weights: &Value,
    seed: &str,
    excluded: Option<(&str, &str)>,
) -> Option<Value> {
    weighted(players, deck, weights, &mut Rng::new(seed), excluded)
}
#[cfg(feature = "legacy-import")]
pub fn weighted_roles_legacy(
    players: &Value,
    deck: &Value,
    weights: &Value,
    seed: &str,
    excluded: Option<(&str, &str)>,
) -> Option<Value> {
    weighted(players, deck, weights, &mut Rng::legacy(seed), excluded)
}
fn weighted(
    players: &Value,
    deck: &Value,
    weights: &Value,
    rng: &mut Rng,
    excluded: Option<(&str, &str)>,
) -> Option<Value> {
    let players: Vec<typed::PlayerSlot> = players
        .as_array()?
        .iter()
        .enumerate()
        .map(|(seat, p)| typed::PlayerSlot {
            id: p["id"].as_str().unwrap_or_default().into(),
            name: String::new(),
            seat,
            role: typed::Role::LoyalServant,
            connected: false,
        })
        .collect();
    let roles: Vec<typed::Role> = decode(deck).ok()?;
    let mut mapped = std::collections::BTreeMap::new();
    for p in &players {
        if let Some(m) = weights[p.id.as_ref()].as_object() {
            let mut w = std::collections::BTreeMap::new();
            for (k, v) in m {
                if let (Ok(role), Some(n)) =
                    (serde_json::from_value::<typed::Role>(json!(k)), v.as_f64())
                {
                    w.insert(role, n);
                }
            }
            mapped.insert(p.id.clone(), w);
        }
    }
    let exclusion = excluded.and_then(|(id, role)| {
        serde_json::from_value::<typed::Role>(json!(role))
            .ok()
            .map(|r| (typed::PlayerId::from(id), r))
    });
    typed::weighted_with_rng(
        &players,
        &roles,
        &mapped,
        rng,
        exclusion.as_ref().map(|(id, r)| (id, *r)),
    )
    .map(encode)
}
// JSON-only compatibility helpers for the offline importer and adapters.
#[cfg(feature = "legacy-import")]
pub(crate) fn str_(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
#[cfg(feature = "legacy-import")]
pub(crate) fn arr(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
#[cfg(feature = "legacy-import")]
pub(crate) fn valid_assignment(deck: &Value, candidate: &Value) -> bool {
    match (
        decode::<Vec<typed::Role>>(deck),
        decode::<Vec<typed::Role>>(candidate),
    ) {
        (Ok(d), Ok(c)) => typed::valid_assignment(&d, &c),
        _ => false,
    }
}
