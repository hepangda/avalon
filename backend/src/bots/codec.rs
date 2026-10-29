//! JSON adapters for offline fixtures and interoperability boundaries.
use super::{decide_detailed_typed, decide_typed};
use crate::engine::{
    self,
    codec::EngineError,
    typed::{ActionKind, ClientGameState, PlayerId},
};
use serde_json::Value;

fn input(
    view: &Value,
    by: &str,
    action: &str,
) -> Result<(ClientGameState, PlayerId, ActionKind), EngineError> {
    let view = serde_json::from_value(view.clone())
        .map_err(|e| engine::codec::error("WRONG_PHASE", format!("Invalid bot view: {e}")))?;
    let action = serde_json::from_value(Value::String(action.into()))
        .map_err(|_| engine::codec::error("WRONG_PHASE", format!("Unknown bot action {action}")))?;
    Ok((view, PlayerId::from(by), action))
}
pub fn decide(view: &Value, by: &str, action: &str, seed: &str) -> Result<Value, EngineError> {
    let (view, by, action) = input(view, by, action)?;
    let decision = decide_typed(&view, &by, action, seed)
        .map_err(|e| engine::codec::error("WRONG_PHASE", e.to_string()))?;
    serde_json::to_value(decision).map_err(|e| engine::codec::error("WRONG_PHASE", e.to_string()))
}
pub fn decide_detailed(
    view: &Value,
    by: &str,
    action: &str,
    seed: &str,
) -> Result<Value, EngineError> {
    let (view, by, action) = input(view, by, action)?;
    let decision = decide_detailed_typed(&view, &by, action, seed)
        .map_err(|e| engine::codec::error("WRONG_PHASE", e.to_string()))?;
    serde_json::to_value(decision).map_err(|e| engine::codec::error("WRONG_PHASE", e.to_string()))
}
/// Only the offline oracle/importer enables the historical random stream.
#[cfg(feature = "legacy-import")]
pub fn decide_legacy_detailed(
    view: &Value,
    by: &str,
    action: &str,
    seed: &str,
) -> Result<Value, EngineError> {
    let (view, by, action) = input(view, by, action)?;
    let decision = super::policy::decide_with_rng(&view, &by, action, seed, engine::Rng::legacy)
        .map_err(|e| engine::codec::error("WRONG_PHASE", e.to_string()))?;
    serde_json::to_value(decision).map_err(|e| engine::codec::error("WRONG_PHASE", e.to_string()))
}
