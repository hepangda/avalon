//! Room domain types. Text is retained for user content and opaque identifiers;
//! closed sets are enums and JSON is confined to boundary adapters.
use crate::engine::typed::{GameOptions, GameState, PlayerId, Role};
use crate::replay::{RecordedEvent, ReplayData};
use serde::{Deserialize, Serialize};
use std::{borrow::Borrow, collections::BTreeMap, fmt, ops::Deref};

macro_rules! identifier {
    ($name:ident) => {
        #[derive(
            Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub String);
        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl From<String> for $name {
            fn from(v: String) -> Self {
                Self(v)
            }
        }
        impl From<&str> for $name {
            fn from(v: &str) -> Self {
                Self(v.into())
            }
        }
        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }
        impl Borrow<str> for $name {
            fn borrow(&self) -> &str {
                &self.0
            }
        }
        impl Deref for $name {
            type Target = str;
            fn deref(&self) -> &str {
                &self.0
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}
identifier!(AccountId);
identifier!(ConnectionId);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoomStatus {
    #[default]
    Lobby,
    InGame,
    Finished,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Public,
    #[default]
    Private,
}
pub use crate::engine::typed::RandomnessVersion;
fn schema_version() -> u8 {
    1
}
fn enabled() -> bool {
    true
}
fn max_players() -> usize {
    10
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_recommended: Option<bool>,
    #[serde(default = "max_players")]
    pub max_players: usize,
    #[serde(default = "enabled")]
    pub allow_spectators: bool,
    #[serde(default = "enabled")]
    pub allow_mid_join: bool,
    pub options: GameOptions,
    #[serde(default)]
    pub roster: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomMeta {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<Visibility>,
    pub host_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_account: Option<AccountId>,
    pub status: RoomStatus,
    pub config: RoomConfig,
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub seed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_offline_since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_humans_offline_since: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: PlayerId,
    pub name: String,
    pub seat: usize,
    #[serde(default)]
    pub is_spectator: bool,
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub claimed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_bot: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency: Option<i64>,
}
impl Member {
    pub fn bot(&self) -> bool {
        self.is_bot == Some(true)
    }
    pub fn human(&self) -> bool {
        self.claimed && !self.is_spectator && !self.bot()
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatHistory {
    #[serde(default)]
    pub by_player: BTreeMap<PlayerId, usize>,
    #[serde(default)]
    pub by_account: BTreeMap<AccountId, usize>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RoleNote {
    Role(Role),
    Label(NoteLabel),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoteLabel {
    #[serde(rename = "good")]
    Good,
    #[serde(rename = "evil")]
    Evil,
    #[serde(rename = "merlin-or-morgana")]
    MerlinOrMorgana,
    #[serde(rename = "percival-claim")]
    PercivalClaim,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesDocument {
    pub game_id: String,
    pub player_id: PlayerId,
    pub role_revision: u64,
    pub revision: u64,
    pub notes: BTreeMap<PlayerId, RoleNote>,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub replay: ReplayData,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seats: Option<BTreeMap<PlayerId, AccountId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub altered: Option<bool>,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reward_accounts: Option<Vec<AccountId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_weight_assignments: Option<BTreeMap<AccountId, Role>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDocument {
    #[serde(default = "schema_version")]
    pub schema_version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub randomness_version: Option<RandomnessVersion>,
    pub meta: RoomMeta,
    #[serde(default)]
    pub members: Vec<Member>,
    pub game: Option<GameState>,
    #[serde(default)]
    pub event_seq: u64,
    #[serde(default)]
    pub events: Vec<RecordedEvent>,
    #[serde(default)]
    pub sessions: BTreeMap<PlayerId, String>,
    #[serde(default)]
    pub notes: BTreeMap<PlayerId, NotesDocument>,
    #[serde(default)]
    pub accounts: BTreeMap<PlayerId, AccountId>,
    #[serde(default)]
    pub game_accounts: BTreeMap<PlayerId, AccountId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_game_seats: Option<SeatHistory>,
    #[serde(default)]
    pub archive: Option<Archive>,
}
impl RoomDocument {
    pub fn active(&self) -> impl Iterator<Item = &Member> {
        self.members.iter().filter(|m| !m.is_spectator)
    }
    pub fn member(&self, id: &PlayerId) -> Option<&Member> {
        self.members.iter().find(|m| m.id == *id)
    }
    pub fn member_mut(&mut self, id: &PlayerId) -> Option<&mut Member> {
        self.members.iter_mut().find(|m| m.id == *id)
    }
    pub fn normalize_after_load(&mut self) {
        self.members.sort_by_key(|m| (m.is_spectator, m.seat));
        for m in &mut self.members {
            m.connected = m.bot();
            m.latency = None;
        }
        if self.last_game_seats.is_none() {
            let mut history = SeatHistory::default();
            let players: Vec<_> = self
                .game
                .as_ref()
                .map(|g| g.players.iter().map(|p| (p.id.clone(), p.seat)).collect())
                .unwrap_or_else(|| {
                    self.active()
                        .filter(|p| p.claimed)
                        .map(|p| (p.id.clone(), p.seat))
                        .collect()
                });
            for (id, seat) in players {
                history.by_player.insert(id.clone(), seat);
                if let Some(a) = self.accounts.get(&id) {
                    history.by_account.insert(a.clone(), seat);
                }
            }
            self.last_game_seats = Some(history);
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct Binding {
    pub account: AccountId,
    pub player: Option<PlayerId>,
    pub host: bool,
    pub referee: bool,
    pub retired: bool,
}
pub type Bindings = BTreeMap<ConnectionId, Binding>;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    SessionReplaced,
    RoomDissolved,
    Kicked,
    Unbound,
}
#[derive(Clone, Debug)]
pub struct Notice {
    pub connection: ConnectionId,
    pub kind: NoticeKind,
}
