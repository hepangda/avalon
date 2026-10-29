//! Offline import adapter for the old recorded stream.
use super::Rng;
use super::codec::*;
use serde_json::{Value, json};
#[cfg(feature = "legacy-import")]
pub(crate) fn legacy_prepare_event(s: &Value, event: &Value, seed: &str) -> Value {
    let mut e = event.clone();
    match str_(&event["type"]) {
        "START_GAME" => {
            let mut rng = Rng::legacy(str_(&s["seed"]));
            let mut roles = arr(&s["config"]["roles"]).to_vec();
            rng.shuffle(&mut roles);
            if valid_assignment(&s["config"]["roles"], &e["assignedRoles"]) {
                roles = arr(&e["assignedRoles"]).to_vec();
            }
            e["assignedRoles"] = Value::Array(roles);
            e["leaderIndex"] =
                json!((rng.next() * arr(&s["players"]).len() as f64).floor() as usize);
        }
        "REROLL_LEADER" => {
            let mut rng = Rng::legacy(seed);
            let players = arr(&s["players"]);
            if !players.is_empty() {
                e["leaderIndex"] =
                    players[(rng.next() * players.len() as f64).floor() as usize]["seat"].clone();
            }
        }
        "REROLL_ROLES" => {
            let mut rng = Rng::legacy(seed);
            let mut roles = arr(&s["config"]["roles"]).to_vec();
            rng.shuffle(&mut roles);
            if valid_assignment(&s["config"]["roles"], &e["assignedRoles"]) {
                roles = arr(&e["assignedRoles"]).to_vec();
            }
            e["assignedRoles"] = Value::Array(roles);
        }
        "USE_REROLL_CARD" => {
            let Some(idx) = arr(&s["players"]).iter().position(|p| p["id"] == e["by"]) else {
                return e;
            };
            let old = &s["players"][idx]["role"];
            let mut rng = Rng::legacy(seed);
            let alternatives: Vec<_> = arr(&s["config"]["roles"])
                .iter()
                .filter(|r| *r != old)
                .cloned()
                .collect();
            if alternatives.is_empty() {
                return e;
            }
            let role =
                alternatives[(rng.next() * alternatives.len() as f64).floor() as usize].clone();
            let mut rest = arr(&s["config"]["roles"]).to_vec();
            rest.remove(rest.iter().position(|r| r == &role).unwrap());
            rng.shuffle(&mut rest);
            if !valid_assignment(&s["config"]["roles"], &e["assignedRoles"])
                || e["assignedRoles"][idx] == *old
            {
                e["assignedRoles"] = Value::Array(
                    arr(&s["players"])
                        .iter()
                        .enumerate()
                        .map(|(i, _)| {
                            if i == idx {
                                role.clone()
                            } else {
                                rest.pop().unwrap()
                            }
                        })
                        .collect(),
                );
            }
        }
        _ => {}
    }
    e
}

use super::typed as native;
#[cfg(feature = "legacy-import")]
#[allow(clippy::result_large_err)] // Returns the same owned state on either outcome.
pub fn apply_legacy_owned(
    state: native::GameState,
    event: &native::GameEvent,
    now: i64,
    seed: &str,
) -> std::result::Result<native::Transition, (native::EngineError, native::GameState)> {
    if state.randomness_version.is_some() {
        return Err((
            native::EngineError::new(
                native::ErrorCode::InvalidRandomness,
                "Legacy importer requires an unversioned legacy state",
            ),
            state,
        ));
    }
    // Only the offline importer decodes its legacy event envelope. Domain execution
    // below still uses the same exhaustive typed rules as live resolved games.
    let raw_state = serde_json::to_value(&state).expect("legacy state codec");
    let raw_event = serde_json::to_value(event).expect("legacy event codec");
    let prepared = legacy_prepare_event(&raw_state, &raw_event, seed);
    match serde_json::from_value::<native::GameEvent>(prepared) {
        Ok(event) => native::apply_legacy(state, &event, now),
        Err(error) => Err((
            native::EngineError::new(native::ErrorCode::InvalidRandomness, error.to_string()),
            state,
        )),
    }
}
