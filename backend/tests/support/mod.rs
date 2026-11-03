//! JSON adapters that let the integration tests replay checked-in fixtures
//! through the typed production APIs.
#![allow(dead_code)]

pub mod engine {
    use avalon_server::engine as typed;
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
    pub fn error(code: &str, message: impl Into<String>) -> EngineError {
        EngineError {
            code: code.into(),
            message: message.into(),
        }
    }
    fn decode<T: for<'de> Deserialize<'de>>(v: &Value) -> Result<T, EngineError> {
        T::deserialize(v)
            .map_err(|e| error("INVALID_RANDOMNESS", format!("Invalid domain data: {e}")))
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
    pub fn reduce(state: &Value, event: &Value, now: i64) -> Result<EngineResult, EngineError> {
        reduce_owned(state.clone(), event, now).map_err(|(e, _)| e)
    }
    pub fn reduce_owned(
        state: Value,
        event: &Value,
        now: i64,
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
        typed::apply_owned(parsed, &event, now)
            .map(transition)
            .map_err(|(e, _)| (e.into(), state))
    }
    pub fn resolve_randomness(
        state: &Value,
        event: &Value,
        seed: &str,
    ) -> Result<Value, EngineError> {
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
        weighted(players, deck, weights, seed, excluded)
    }
    fn weighted(
        players: &Value,
        deck: &Value,
        weights: &Value,
        seed: &str,
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
        typed::weighted_roles(
            &players,
            &roles,
            &mapped,
            seed,
            exclusion.as_ref().map(|(id, r)| (id, *r)),
        )
        .map(encode)
    }
}

pub mod bots {
    use super::engine::{self, EngineError};
    use avalon_server::bots as native;
    use avalon_server::engine::{ActionKind, ClientGameState, PlayerId};
    use serde_json::Value;

    fn input(
        view: &Value,
        by: &str,
        action: &str,
    ) -> Result<(ClientGameState, PlayerId, ActionKind), EngineError> {
        let view = serde_json::from_value(view.clone())
            .map_err(|e| engine::error("WRONG_PHASE", format!("Invalid bot view: {e}")))?;
        let action = serde_json::from_value(Value::String(action.into()))
            .map_err(|_| engine::error("WRONG_PHASE", format!("Unknown bot action {action}")))?;
        Ok((view, PlayerId::from(by), action))
    }
    pub fn decide(view: &Value, by: &str, action: &str, seed: &str) -> Result<Value, EngineError> {
        let (view, by, action) = input(view, by, action)?;
        let decision = native::decide(&view, &by, action, seed)
            .map_err(|e| engine::error("WRONG_PHASE", e.to_string()))?;
        serde_json::to_value(decision).map_err(|e| engine::error("WRONG_PHASE", e.to_string()))
    }
    pub fn decide_detailed(
        view: &Value,
        by: &str,
        action: &str,
        seed: &str,
    ) -> Result<Value, EngineError> {
        let (view, by, action) = input(view, by, action)?;
        let decision = native::decide_detailed(&view, &by, action, seed)
            .map_err(|e| engine::error("WRONG_PHASE", e.to_string()))?;
        serde_json::to_value(decision).map_err(|e| engine::error("WRONG_PHASE", e.to_string()))
    }
}

pub mod ratings {
    use anyhow::Result;
    use avalon_server::ratings::{Exclusion, Fit, Player, Record, fit_records, public_rating};
    use serde::Deserialize;
    use serde_json::Value;

    pub fn fit(input: &[Value], include_bots: bool) -> Result<Fit> {
        let records: Vec<Record> = input
            .iter()
            .map(Record::deserialize)
            .collect::<std::result::Result<_, _>>()?;
        fit_records(records.iter(), include_bots)
    }
    pub fn exclusion(game: &Value, include_bots: bool) -> Option<&'static str> {
        match Record::deserialize(game) {
            Ok(record) => record.exclusion(include_bots).map(Exclusion::as_str),
            Err(_) => Some("invalid"),
        }
    }
    pub fn public(player: Option<&Player>, now: i64) -> Value {
        serde_json::to_value(public_rating(player, now)).expect("finite public rating")
    }
}

pub mod replay {
    use anyhow::{Context, Result};
    use avalon_server::{
        engine::GameOptions,
        replay::{RecordedEvent, ReplayPlayer},
    };
    use serde_json::Value;

    pub fn build(
        game_id: &str,
        seed: &str,
        options: &Value,
        players: &Value,
        events: &[Value],
    ) -> Result<Value> {
        let options: GameOptions =
            serde_json::from_value(options.clone()).context("Invalid replay options")?;
        let players: Vec<ReplayPlayer> =
            serde_json::from_value(players.clone()).context("Invalid replay roster")?;
        let events: Vec<RecordedEvent> = events
            .iter()
            .cloned()
            .map(serde_json::from_value)
            .collect::<std::result::Result<_, _>>()
            .context("Invalid recorded event")?;
        let replay = avalon_server::replay::build(game_id, seed, &options, &players, &events)?;
        Ok(serde_json::to_value(replay)?)
    }
}
