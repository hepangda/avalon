//! Strongly typed authoritative rules. JSON adapters live in `codec`; live rooms
//! retain typed state and dispatch exhaustive commands without string lookups.
pub mod codec;
#[cfg(feature = "legacy-import")]
mod legacy;
mod rng;
pub mod typed;
pub use typed::*;
