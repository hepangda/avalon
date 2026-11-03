//! Seat-visible Bayesian policy. It takes an authorized client view and returns
//! typed commands.
mod policy;
pub use policy::{
    Beliefs, BotError, Decision, Reason, decide, decide_detailed, designated_saboteurs, entropy,
    fail_distribution, merlin_suspicions,
};
pub const BOT_DELAY_MS: i64 = 2_000;
