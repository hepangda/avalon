use crate::engine::typed::{
    ClientLogEntry, GameEvent, GameOptions, GameOutcome, MissionCard, PlayerId, Role, Team, Vote,
};
use serde::{Deserialize, Serialize};

/// Public replay DTOs are distinct from authoritative game state. In particular,
/// private notes, seat credentials, RNG seeds and account bindings cannot appear.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPlayer {
    pub id: PlayerId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_bot: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedEvent {
    pub seq: u64,
    pub event: GameEvent,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRole {
    pub player_id: PlayerId,
    pub role: Role,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_variant: Option<u8>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayVote {
    pub proposal_index: usize,
    pub player_id: PlayerId,
    pub value: Vote,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayProposal {
    pub proposal_index: usize,
    pub leader_player_id: PlayerId,
    pub team: Vec<PlayerId>,
    pub approved: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCard {
    pub player_id: PlayerId,
    pub card: MissionCard,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRound {
    pub round_index: usize,
    pub leader_player_id: PlayerId,
    pub team_size: usize,
    pub final_team: Option<Vec<PlayerId>>,
    pub approved: Option<bool>,
    pub mission_success: Option<bool>,
    pub fail_count: Option<usize>,
    pub votes: Vec<ReplayVote>,
    #[serde(default)]
    pub proposals: Vec<ReplayProposal>,
    pub mission_cards: Vec<ReplayCard>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayLady {
    pub round_index: usize,
    pub holder_player_id: PlayerId,
    pub target_player_id: PlayerId,
    pub revealed_team: Team,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayAssassination {
    pub assassin_player_id: PlayerId,
    pub target_player_id: PlayerId,
    pub hit_merlin: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayData {
    pub format_version: u8,
    pub game_id: String,
    pub outcome: GameOutcome,
    pub role_assignments: Vec<ReplayRole>,
    pub players: Vec<ReplayPlayer>,
    pub rounds: Vec<ReplayRound>,
    pub lady_checks: Vec<ReplayLady>,
    pub assassination: Option<ReplayAssassination>,
    pub options: GameOptions,
    pub log: Vec<ClientLogEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
}
