//! WebAssembly exports that let the development gallery and frontend tests run
//! the authoritative rules. Requests and replies are UTF-8 JSON in linear
//! memory, so JavaScript needs no generated bindings.
use avalon_engine::{
    CreateGame, EngineError, GameEvent, GameState, PlayerId, apply_owned, create_game, project,
    resolve_randomness,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    CreateGame {
        input: CreateGame,
    },
    /// Resolves randomness the way a live room does, then applies the event.
    Apply {
        state: GameState,
        event: GameEvent,
        now: i64,
    },
    Project {
        state: GameState,
        viewer: PlayerId,
    },
}

#[derive(Serialize)]
#[serde(untagged)]
enum Reply {
    Ok { ok: bool, value: Value },
    Err { ok: bool, error: EngineError },
}

fn encode(value: impl Serialize) -> Result<Value, EngineError> {
    serde_json::to_value(value).map_err(|e| invalid(e.to_string()))
}

fn invalid(message: String) -> EngineError {
    EngineError::new(avalon_engine::ErrorCode::InvalidRandomness, message)
}

fn handle(request: Request) -> Result<Value, EngineError> {
    match request {
        Request::CreateGame { input } => encode(create_game(input)?),
        Request::Apply { state, event, now } => {
            let seed = format!("{}:{}:outcome", state.seed, state.log_seq);
            let event = resolve_randomness(&state, &event, &seed)?;
            let transition = apply_owned(state, &event, now).map_err(|(e, _)| e)?;
            encode(transition.state)
        }
        Request::Project { state, viewer } => encode(project(&state, &viewer)),
    }
}

/// Reserves `len` bytes for a request the caller writes before `call`.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// Frees a buffer returned by `alloc` or `call`.
///
/// # Safety
/// `ptr` and `len` must describe a buffer this module handed out and not yet freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
}

/// Handles one JSON request and returns the reply buffer as `ptr << 32 | len`.
///
/// # Safety
/// `ptr` and `len` must describe an initialized buffer from `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn call(ptr: *const u8, len: usize) -> u64 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let reply = match serde_json::from_slice(input)
        .map_err(|e| invalid(format!("Invalid request: {e}")))
        .and_then(handle)
    {
        Ok(value) => Reply::Ok { ok: true, value },
        Err(error) => Reply::Err { ok: false, error },
    };
    let bytes = serde_json::to_vec(&reply)
        .expect("replies serialize")
        .into_boxed_slice();
    let len = bytes.len() as u64;
    (Box::into_raw(bytes).cast::<u8>() as usize as u64) << 32 | len
}
