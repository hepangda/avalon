//! JSON is decoded once at the transport boundary into exhaustive room commands.
use super::model::{NotesDocument, RoleNote, Visibility};
use crate::engine::typed::{
    Direction, EngineError, ErrorCode as EngineCode, MissionCard, PlayerId, Vote,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RoomErrorCode {
    AuthRequired,
    NotInRoom,
    RoomNotFound,
    Reconnect,
    NotHost,
    WrongPhase,
    NotAdmin,
    UnknownPlayer,
    UnknownSeat,
    RoomFull,
    SeatTaken,
    AlreadySeated,
    InvalidName,
    NameTaken,
    Invalid,
    InvalidTarget,
    InvalidPlayerCount,
    SeatClaimed,
    NoGame,
    NoRerollCards,
    NotSeated,
    StaleNotesScope,
    NotesConflict,
    UnknownEvent,
    Internal,
    NotJoined,
    RateLimited,
}
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum ErrorCode {
    Room(RoomErrorCode),
    Engine(EngineCode),
}
#[derive(Clone, Debug, Serialize)]
pub struct Error {
    pub code: ErrorCode,
    pub message: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum Reply {
    Join {
        #[serde(rename = "playerId", skip_serializing_if = "Option::is_none")]
        player_id: Option<PlayerId>,
        #[serde(rename = "playerToken", skip_serializing_if = "Option::is_none")]
        player_token: Option<String>,
        #[serde(rename = "isHost")]
        is_host: bool,
    },
    Seat {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "playerToken")]
        player_token: String,
    },
    Name {
        name: String,
    },
    Notes(NotesDocument),
    Referee {
        ok: bool,
    },
}
#[derive(Clone, Debug, Serialize)]
pub struct Ack {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Error>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Reply>,
}
impl Ack {
    pub fn ok() -> Self {
        Self {
            ok: true,
            error: None,
            data: None,
        }
    }
    pub fn data(data: Reply) -> Self {
        Self {
            ok: true,
            error: None,
            data: Some(data),
        }
    }
    pub fn fail(code: RoomErrorCode, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(Error {
                code: ErrorCode::Room(code),
                message: message.into(),
            }),
            data: None,
        }
    }
    pub fn engine(e: EngineError) -> Self {
        Self {
            ok: false,
            error: Some(Error {
                code: ErrorCode::Engine(e.code),
                message: e.message,
            }),
            data: None,
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputOptions {
    pub oberon: Option<bool>,
    pub mordred: Option<bool>,
    pub morgana: Option<bool>,
    pub percival: Option<bool>,
    pub lady_of_the_lake: Option<bool>,
    pub max_rejections: Option<f64>,
    pub speech_seconds: Option<f64>,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInput {
    pub use_recommended: Option<bool>,
    pub max_players: Option<f64>,
    pub options: Option<InputOptions>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    pub name: String,
    pub account: super::model::AccountId,
    #[serde(default)]
    pub avatar_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Init {
    pub creator: Creator,
    #[serde(default)]
    pub roster: Vec<String>,
    #[serde(default)]
    pub config: Option<ConfigInput>,
}
#[derive(Clone, Debug)]
pub enum InitOutcome {
    Created {
        host_token: String,
        player_id: PlayerId,
        player_token: String,
    },
    Exists,
    InvalidCreator,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesUpdate {
    pub base_revision: u64,
    pub notes: BTreeMap<PlayerId, RoleNote>,
    pub enabled: bool,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesRequest {
    pub game_id: String,
    pub role_revision: u64,
    pub player_id: PlayerId,
    #[serde(default)]
    pub update: Option<NotesUpdate>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Emote {
    Approve,
    Reject,
    Trust,
    Suspect,
    Question,
    Ponder,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "event", content = "payload", rename_all_fields = "camelCase")]
pub enum Command {
    #[serde(rename = "room:join")]
    Join {
        #[serde(default)]
        player_id: Option<PlayerId>,
        #[serde(default)]
        player_token: Option<String>,
        #[serde(default)]
        host_token: Option<String>,
    },
    #[serde(rename = "room:resync")]
    Resync {},
    #[serde(rename = "room:leave")]
    Leave {},
    #[serde(rename = "room:details")]
    Details {
        name: String,
        visibility: Visibility,
    },
    #[serde(rename = "room:config")]
    Config { config: ConfigInput },
    #[serde(rename = "room:rename")]
    Rename { name: String },
    #[serde(rename = "room:transferHost")]
    TransferHost { target_player_id: PlayerId },
    #[serde(rename = "room:kick")]
    Kick { target_player_id: PlayerId },
    #[serde(rename = "room:addBot")]
    AddBot {},
    #[serde(rename = "room:start")]
    Start {},
    #[serde(rename = "room:restart")]
    Restart {},
    #[serde(rename = "room:removeSeat")]
    RemoveSeat { seat_id: PlayerId },
    #[serde(rename = "room:claimSeat")]
    ClaimSeat {
        #[serde(default)]
        seat_id: Option<PlayerId>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        avatar_url: Option<String>,
    },
    #[serde(rename = "room:releaseSeat")]
    ReleaseSeat {},
    #[serde(rename = "room:setRoster")]
    SetRoster { names: Vec<String> },
    #[serde(rename = "game:useRerollCard")]
    UseRerollCard { role_revision: u64 },
    #[serde(rename = "game:ackRole")]
    AckRole {
        #[serde(default)]
        role_revision: Option<u64>,
    },
    #[serde(rename = "game:proposeTeam")]
    ProposeTeam { team: Vec<PlayerId> },
    #[serde(rename = "game:finalizeTeam")]
    FinalizeTeam { team: Vec<PlayerId> },
    #[serde(rename = "game:startDiscussion")]
    StartDiscussion {
        #[serde(default)]
        direction: Option<Direction>,
    },
    #[serde(rename = "game:endSpeech")]
    EndSpeech {},
    #[serde(rename = "game:vote")]
    Vote { value: Vote },
    #[serde(rename = "game:missionCard")]
    MissionCard { card: MissionCard },
    #[serde(rename = "game:useLady")]
    UseLady { target_player_id: PlayerId },
    #[serde(rename = "game:startAssassination")]
    StartAssassination {},
    #[serde(rename = "game:voteAssassination")]
    VoteAssassination { proposal_id: u64, value: Vote },
    #[serde(rename = "game:assassinate")]
    Assassinate { target_player_id: PlayerId },
    #[serde(rename = "notes:sync")]
    Notes(NotesRequest),
    #[serde(rename = "net:ping")]
    Ping {
        #[serde(default)]
        rtt: Option<f64>,
    },
    #[serde(rename = "table:emote")]
    Emote { emote: Emote },
    #[serde(rename = "admin:auth")]
    AdminAuth {},
    #[serde(rename = "admin:close")]
    AdminClose {},
    #[serde(rename = "admin:unbind")]
    AdminUnbind { target_player_id: PlayerId },
    #[serde(rename = "admin:vote")]
    AdminVote {
        target_player_id: PlayerId,
        value: Vote,
    },
    #[serde(rename = "admin:propose")]
    AdminPropose { team: Vec<PlayerId> },
    #[serde(rename = "admin:retractVotes")]
    AdminRetractVotes {},
    #[serde(rename = "admin:retractProposal")]
    AdminRetractProposal {},
    #[serde(rename = "admin:startAssassination")]
    AdminStartAssassination {},
    #[serde(rename = "admin:previousPhase")]
    AdminPreviousPhase {},
    #[serde(rename = "admin:skipSpeech")]
    AdminSkipSpeech { target_player_id: PlayerId },
    #[serde(rename = "admin:setTimersPaused")]
    AdminSetTimersPaused { paused: bool },
    #[serde(rename = "admin:rerollLeader")]
    AdminRerollLeader {},
    #[serde(rename = "admin:rerollRoles")]
    AdminRerollRoles {},
}
impl Command {
    pub fn needs_host(&self) -> bool {
        matches!(
            self,
            Self::Details { .. }
                | Self::Config { .. }
                | Self::TransferHost { .. }
                | Self::Kick { .. }
                | Self::AddBot {}
                | Self::Start {}
                | Self::Restart {}
                | Self::RemoveSeat { .. }
                | Self::SetRoster { .. }
        )
    }
    pub fn lobby_only(&self) -> bool {
        matches!(
            self,
            Self::Config { .. }
                | Self::Kick { .. }
                | Self::AddBot {}
                | Self::RemoveSeat { .. }
                | Self::SetRoster { .. }
                | Self::ClaimSeat { .. }
        )
    }
    pub fn needs_referee(&self) -> bool {
        matches!(
            self,
            Self::AdminUnbind { .. }
                | Self::AdminVote { .. }
                | Self::AdminPropose { .. }
                | Self::AdminRetractVotes {}
                | Self::AdminRetractProposal {}
                | Self::AdminStartAssassination {}
                | Self::AdminPreviousPhase {}
                | Self::AdminSkipSpeech { .. }
                | Self::AdminSetTimersPaused { .. }
                | Self::AdminRerollLeader {}
                | Self::AdminRerollRoles {}
        )
    }
    pub fn needs_weights(&self) -> bool {
        matches!(
            self,
            Self::Start {} | Self::UseRerollCard { .. } | Self::AdminRerollRoles {}
        )
    }
    pub fn uses_card(&self) -> bool {
        matches!(self, Self::UseRerollCard { .. })
    }
    pub fn decode(event: &str, payload: serde_json::Value) -> Result<Self, CommandParseError> {
        serde_json::from_value(serde_json::json!({"event":event,"payload":payload})).map_err(|_| {
            // Probe only the tag with an empty payload. A nested invalid Vote or
            // Role must not be reported as an unknown command name.
            let unknown =
                serde_json::from_value::<Self>(serde_json::json!({"event":event,"payload":{}}))
                    .is_err_and(|e| e.to_string().starts_with("unknown variant"));
            CommandParseError {
                code: if unknown {
                    RoomErrorCode::UnknownEvent
                } else {
                    RoomErrorCode::Invalid
                },
            }
        })
    }
}
#[derive(Clone, Copy, Debug)]
pub struct CommandParseError {
    pub code: RoomErrorCode,
}
impl From<CommandParseError> for Ack {
    fn from(error: CommandParseError) -> Self {
        Self::fail(error.code, "Invalid room command")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn invalid_payload_is_not_an_unknown_command() {
        assert_eq!(
            Command::decode("game:vote", json!({"value":"game:vote"}))
                .unwrap_err()
                .code,
            RoomErrorCode::Invalid
        );
        assert_eq!(
            Command::decode("game:unknown", json!({})).unwrap_err().code,
            RoomErrorCode::UnknownEvent
        );
        assert_eq!(
            Command::decode("game:useRerollCard", json!({"roleRevision":-1}))
                .unwrap_err()
                .code,
            RoomErrorCode::Invalid
        );
        assert_eq!(
            Command::decode("admin:setTimersPaused", json!({"paused":"true"}))
                .unwrap_err()
                .code,
            RoomErrorCode::Invalid
        );
        assert!(matches!(
            Command::decode("game:vote", json!({"value":"approve"})),
            Ok(Command::Vote {
                value: Vote::Approve
            })
        ));
    }
}
