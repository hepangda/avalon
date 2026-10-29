pub mod auth;
pub mod bots;
pub mod cpu;
pub mod engine;
pub mod history;
pub mod http;
pub mod journal;
pub mod migration;
pub mod ratings;
pub mod replay;
pub mod room;
pub mod static_files;
pub mod storage;

#[derive(Clone)]
pub struct AppState {
    pub db: storage::Database,
    pub rooms: room::RoomRegistry,
    pub auth: auth::Auth,
    pub public_origin: String,
    pub environment: String,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
