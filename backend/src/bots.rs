//! Seat-visible Bayesian policy. The live API takes an authorized typed view
//! and returns typed commands; JSON adapters are explicit in `codec`.
pub mod codec;
mod policy;
pub use policy::{
    Beliefs, BotError, Decision, Reason, decide_detailed_typed, decide_typed, designated_saboteurs,
    entropy, fail_distribution, merlin_suspicions,
};
pub use policy::{decide_detailed_typed as decide_detailed, decide_typed as decide};
pub const BOT_DELAY_MS: i64 = 2_000;
