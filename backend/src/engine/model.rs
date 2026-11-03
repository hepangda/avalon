use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::{borrow::Borrow, collections::BTreeMap, fmt};

#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlayerId(pub String);
impl From<&str> for PlayerId {
    fn from(v: &str) -> Self {
        Self(v.into())
    }
}
impl From<String> for PlayerId {
    fn from(v: String) -> Self {
        Self(v)
    }
}
impl AsRef<str> for PlayerId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}
impl Borrow<str> for PlayerId {
    fn borrow(&self) -> &str {
        &self.0
    }
}
impl fmt::Display for PlayerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

macro_rules! string_enum {
    ($name:ident {$($variant:ident => $wire:literal),+ $(,)?}) => {
        #[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord,Hash,Serialize,Deserialize)]
        pub enum $name {$(#[serde(rename=$wire)] $variant),+}
        impl $name {pub const fn as_str(self)->&'static str{match self{$(Self::$variant=>$wire),+}}}
        impl fmt::Display for $name {fn fmt(&self,f:&mut fmt::Formatter<'_>)->fmt::Result{f.write_str(self.as_str())}}
    }
}
string_enum!(Role {Merlin=>"Merlin",Percival=>"Percival",LoyalServant=>"LoyalServant",Morgana=>"Morgana",Assassin=>"Assassin",Oberon=>"Oberon",Mordred=>"Mordred",Minion=>"Minion"});
impl Role {
    pub const fn team(self) -> Team {
        match self {
            Self::Merlin | Self::Percival | Self::LoyalServant => Team::Good,
            _ => Team::Evil,
        }
    }
    pub const fn is_evil(self) -> bool {
        matches!(self.team(), Team::Evil)
    }
}
string_enum!(Team {Good=>"good",Evil=>"evil"});
string_enum!(Phase {Lobby=>"Lobby",RoleReveal=>"RoleReveal",TeamBuilding=>"TeamBuilding",TeamAnnouncement=>"TeamAnnouncement",Discussion=>"Discussion",TeamFinalizing=>"TeamFinalizing",Voting=>"Voting",MissionVote=>"MissionVote",MissionResult=>"MissionResult",LadyOfLake=>"LadyOfLake",Assassination=>"Assassination",GameOver=>"GameOver"});
string_enum!(Vote {Approve=>"approve",Reject=>"reject"});
string_enum!(MissionCard {Success=>"success",Fail=>"fail"});
string_enum!(Direction {Clockwise=>"clockwise",Counterclockwise=>"counterclockwise"});
string_enum!(ActionKind {Role=>"role",Propose=>"propose",Announce=>"announce",Speak=>"speak",Finalize=>"finalize",Vote=>"vote",Mission=>"mission",Lady=>"lady",Assassinate=>"assassinate"});
string_enum!(CheckpointKind {GameStarted=>"game_started",Vote=>"vote",MissionResult=>"mission_result",Lady=>"lady",GameOver=>"game_over"});
string_enum!(WinReason {ThreeMissions=>"three_missions",FiveRejections=>"five_rejections",RejectionLimit=>"rejection_limit",AssassinatedMerlin=>"assassinated_merlin",AssassinMissed=>"assassin_missed"});
string_enum!(ShownAs {Evil=>"evil",MerlinOrMorgana=>"merlin-or-morgana",KnownAlly=>"known-ally"});
string_enum!(LogChannel {Public=>"public",Private=>"private"});
string_enum!(LogStyle {Admin=>"admin"});
string_enum!(RandomnessVersion {ResolvedV1=>"resolved-v1"});
string_enum!(ErrorCode {WrongPhase=>"WRONG_PHASE",RolesPending=>"ROLES_PENDING",NotHost=>"NOT_HOST",NotLeader=>"NOT_LEADER",NotSpeaker=>"NOT_SPEAKER",NotAssassin=>"NOT_ASSASSIN",NotLadyHolder=>"NOT_LADY_HOLDER",UnknownPlayer=>"UNKNOWN_PLAYER",InvalidPlayerCount=>"INVALID_PLAYER_COUNT",InvalidRoleSet=>"INVALID_ROLE_SET",WrongTeamSize=>"WRONG_TEAM_SIZE",InvalidDirection=>"INVALID_DIRECTION",InvalidTeamMember=>"INVALID_TEAM_MEMBER",DuplicateTeamMember=>"DUPLICATE_TEAM_MEMBER",AlreadyVoted=>"ALREADY_VOTED",AlreadyPlayedCard=>"ALREADY_PLAYED_CARD",NotOnTeam=>"NOT_ON_TEAM",GoodCannotFail=>"GOOD_CANNOT_FAIL",LadyTargetSelf=>"LADY_TARGET_SELF",LadyTargetInspected=>"LADY_TARGET_INSPECTED",AssassinTargetInvalid=>"ASSASSIN_TARGET_INVALID",InvalidRandomness=>"INVALID_RANDOMNESS"});
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EngineError {
    pub code: ErrorCode,
    pub message: String,
}
impl EngineError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for EngineError {}
pub type Result<T> = std::result::Result<T, EngineError>;
pub type Votes = IndexMap<PlayerId, Vote>;
pub type Cards = IndexMap<PlayerId, MissionCard>;
pub type RoleVariants = IndexMap<PlayerId, u8>;
pub type RoleWeights = BTreeMap<Role, f64>;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum LogParam {
    String(String),
    Number(f64),
}
impl Serialize for LogParam {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::String(v) => s.serialize_str(v),
            Self::Number(n) => serialize_number(*n, s),
        }
    }
}
fn serialize_number<S: serde::Serializer>(n: f64, s: S) -> std::result::Result<S::Ok, S::Error> {
    if n.fract() == 0. && n.abs() <= 9_007_199_254_740_991. {
        s.serialize_i64(n as i64)
    } else {
        s.serialize_f64(n)
    }
}
fn optional_number<S: serde::Serializer>(
    n: &Option<f64>,
    s: S,
) -> std::result::Result<S::Ok, S::Error> {
    match n {
        Some(n) => serialize_number(*n, s),
        None => s.serialize_none(),
    }
}
impl LogParam {
    pub fn as_str(&self) -> Option<&str> {
        if let Self::String(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        if let Self::Number(v) = self {
            Some(*v)
        } else {
            None
        }
    }
}
impl From<String> for LogParam {
    fn from(s: String) -> Self {
        Self::String(s)
    }
}
impl From<&str> for LogParam {
    fn from(s: &str) -> Self {
        Self::String(s.into())
    }
}
impl From<PlayerId> for LogParam {
    fn from(s: PlayerId) -> Self {
        Self::String(s.0)
    }
}
impl From<&PlayerId> for LogParam {
    fn from(s: &PlayerId) -> Self {
        Self::String(s.0.clone())
    }
}
impl From<usize> for LogParam {
    fn from(n: usize) -> Self {
        Self::Number(n as f64)
    }
}
impl From<i64> for LogParam {
    fn from(n: i64) -> Self {
        Self::Number(n as f64)
    }
}
pub type LogParams = BTreeMap<String, LogParam>;

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameOptions {
    #[serde(default)]
    pub oberon: bool,
    #[serde(default)]
    pub mordred: bool,
    #[serde(default)]
    pub morgana: bool,
    #[serde(default)]
    pub percival: bool,
    #[serde(default)]
    pub lady_of_the_lake: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_number"
    )]
    pub max_rejections: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_number"
    )]
    pub speech_seconds: Option<f64>,
}
impl GameOptions {
    pub fn rejection_limit(&self) -> usize {
        self.max_rejections
            .filter(|n| n.is_finite())
            .map(|n| n.floor().clamp(1., 5.) as usize)
            .unwrap_or(5)
    }
    pub fn speech_duration(&self) -> i64 {
        self.speech_seconds
            .filter(|n| n.is_finite())
            .map(|n| n.floor().clamp(30., 600.) as i64)
            .unwrap_or(120)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameConfig {
    pub player_count: usize,
    pub options: GameOptions,
    pub roles: Vec<Role>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InitialPlayer {
    pub id: PlayerId,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGame {
    pub host_id: PlayerId,
    pub players: Vec<InitialPlayer>,
    pub options: GameOptions,
    pub seed: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlayerSlot {
    pub id: PlayerId,
    pub name: String,
    pub seat: usize,
    pub role: Role,
    pub connected: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionOutcome {
    pub round_index: usize,
    pub team_size: usize,
    pub team: Vec<PlayerId>,
    pub success: bool,
    pub fail_count: usize,
    pub cards: Cards,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoteRecord {
    pub round_index: usize,
    pub proposal_index: usize,
    pub leader_id: PlayerId,
    pub team: Vec<PlayerId>,
    pub votes: Votes,
    pub approved: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealedRole {
    pub player_id: PlayerId,
    pub role: Role,
    pub team: Team,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MissionTally {
    pub good: usize,
    pub evil: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameOutcome {
    pub winner: Team,
    pub reason: WinReason,
    pub mission_tally: MissionTally,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assassin_target_id: Option<PlayerId>,
    pub revealed_roles: Vec<RevealedRole>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub seq: u64,
    pub round_index: usize,
    pub at: i64,
    pub channel: LogChannel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<PlayerId>,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<LogParams>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<LogStyle>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionState {
    pub order: Vec<PlayerId>,
    pub speaker_index: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionTimer {
    pub player_id: PlayerId,
    pub action: ActionKind,
    pub started_at: i64,
    pub duration_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_at: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LadyResult {
    pub holder_id: PlayerId,
    pub target_id: PlayerId,
    pub loyalty: Team,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssassinationBallot {
    pub id: u64,
    pub initiator_id: PlayerId,
    pub voter_ids: Vec<PlayerId>,
    pub votes: Votes,
}
fn present<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(T::deserialize(deserializer)?))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub randomness_version: Option<RandomnessVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_variants: Option<RoleVariants>,
    pub phase: Phase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow_version: Option<u8>,
    #[serde(default)]
    pub discussion: Option<DiscussionState>,
    #[serde(default)]
    pub action_timers: Vec<ActionTimer>,
    pub config: GameConfig,
    pub seed: String,
    pub players: Vec<PlayerSlot>,
    pub round_index: usize,
    pub leader_index: usize,
    pub rejection_count: usize,
    pub proposed_team: Option<Vec<PlayerId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_changed: Option<bool>,
    pub votes: Votes,
    pub mission_cards: Cards,
    pub mission_results: Vec<MissionOutcome>,
    pub vote_history: Vec<VoteRecord>,
    pub logs: Vec<LogEntry>,
    pub log_seq: u64,
    pub role_acks: Vec<PlayerId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub await_role_acks: Option<bool>,
    pub lady_enabled: bool,
    pub lady_holder_id: Option<PlayerId>,
    pub lady_inspected_ids: Vec<PlayerId>,
    pub pending_lady: bool,
    pub last_lady_result: Option<LadyResult>,
    pub assassin_id: Option<PlayerId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub early_assassination: Option<Option<AssassinationBallot>>,
    pub outcome: Option<GameOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_history: Option<Vec<PhaseCheckpoint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_revision: Option<u64>,
    #[serde(default)]
    pub opening_closed: bool,
    #[serde(default)]
    pub role_revision: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseCheckpoint {
    pub phase: Phase,
    pub round_index: usize,
    pub leader_index: usize,
    pub rejection_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_changed: Option<bool>,
    pub proposed_team: Option<Vec<PlayerId>>,
    pub discussion: Option<DiscussionState>,
    pub votes: Votes,
    pub mission_cards: Cards,
    pub mission_results: Vec<MissionOutcome>,
    pub vote_history: Vec<VoteRecord>,
    pub lady_holder_id: Option<PlayerId>,
    pub lady_inspected_ids: Vec<PlayerId>,
    pub pending_lady: bool,
    pub last_lady_result: Option<LadyResult>,
    pub outcome: Option<GameOutcome>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum GameEvent {
    StartGame {
        by: PlayerId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flow_version: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assigned_roles: Option<Vec<Role>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        await_role_acks: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        leader_index: Option<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role_variants: Option<RoleVariants>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seat_order: Option<Vec<PlayerId>>,
    },
    AckRole {
        by: PlayerId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role_revision: Option<u64>,
    },
    RerollLeader {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        leader_index: Option<usize>,
    },
    RerollRoles {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assigned_roles: Option<Vec<Role>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role_variants: Option<RoleVariants>,
    },
    UseRerollCard {
        by: PlayerId,
        role_revision: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assigned_roles: Option<Vec<Role>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role_variants: Option<RoleVariants>,
    },
    ProposeTeam {
        by: PlayerId,
        team: Vec<PlayerId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        admin: Option<bool>,
    },
    FinalizeTeam {
        by: PlayerId,
        team: Vec<PlayerId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        admin: Option<bool>,
    },
    StartDiscussion {
        by: PlayerId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        direction: Option<Direction>,
    },
    EndSpeech {
        by: PlayerId,
    },
    SkipSpeech {
        target: PlayerId,
        actor: String,
    },
    SetTimersPaused {
        paused: bool,
        actor: String,
    },
    CastVote {
        by: PlayerId,
        value: Vote,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        admin: Option<bool>,
    },
    RetractVotes,
    RetractProposal,
    CastMissionCard {
        by: PlayerId,
        card: MissionCard,
    },
    UseLady {
        by: PlayerId,
        target: PlayerId,
    },
    RequestAssassination {
        by: PlayerId,
    },
    VoteAssassination {
        by: PlayerId,
        proposal_id: u64,
        value: Vote,
    },
    StartAssassination {
        by: PlayerId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        admin: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        actor: Option<String>,
    },
    PreviousPhase {
        actor: String,
    },
    Assassinate {
        by: PlayerId,
        target: PlayerId,
    },
    SetConnected {
        by: PlayerId,
        connected: bool,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Effect {
    PersistCheckpoint { checkpoint: CheckpointKind },
}
#[derive(Clone, Debug)]
pub struct Transition {
    pub state: GameState,
    pub effects: Vec<Effect>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPlayer {
    pub id: PlayerId,
    pub name: String,
    pub seat: usize,
    pub connected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_bot: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_variant: Option<u8>,
    pub is_leader: bool,
    pub is_lady_holder: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityInfo {
    pub player_id: PlayerId,
    pub shown_as: ShownAs,
    pub certain: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientVote {
    pub player_id: PlayerId,
    pub has_voted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vote: Option<Vote>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedVote {
    pub player_id: PlayerId,
    pub vote: Vote,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientVoteRecord {
    pub round_index: usize,
    pub proposal_index: usize,
    pub leader_id: PlayerId,
    pub team: Vec<PlayerId>,
    pub votes: Vec<RecordedVote>,
    pub approved: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMissionResult {
    pub round_index: usize,
    pub success: bool,
    pub fail_count: usize,
    pub team_size: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientLogEntry {
    pub seq: u64,
    pub round_index: usize,
    pub at: i64,
    pub channel: LogChannel,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<LogParams>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<LogStyle>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub player_count: usize,
    pub mission_sizes: Vec<usize>,
    pub required_fails: Vec<usize>,
    pub roles_in_play: Vec<Role>,
    pub max_rejections: usize,
    pub speech_seconds: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LadyView {
    pub holder_id: Option<PlayerId>,
    pub inspected_ids: Vec<PlayerId>,
    pub pending: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateLadyResult {
    pub target_id: PlayerId,
    pub loyalty: Team,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientGameState {
    pub phase: Phase,
    pub discussion: Option<DiscussionState>,
    pub action_timers: Vec<ActionTimer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_time: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_phase: Option<Phase>,
    pub phase_revision: u64,
    pub role_revision: u64,
    pub can_reroll_opening: bool,
    pub round_index: usize,
    pub leader_index: usize,
    pub rejection_count: usize,
    pub players: Vec<ClientPlayer>,
    pub self_role: Option<Role>,
    pub known_players: Vec<VisibilityInfo>,
    pub role_acks: Vec<PlayerId>,
    pub roles_pending: bool,
    pub proposed_team: Option<Vec<PlayerId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_changed: Option<bool>,
    pub votes: Option<Vec<ClientVote>>,
    pub mission_submissions: Vec<PlayerId>,
    pub mission_results: Vec<ClientMissionResult>,
    pub vote_history: Vec<ClientVoteRecord>,
    pub logs: Vec<ClientLogEntry>,
    pub config: ClientConfig,
    pub lady: Option<LadyView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_lady_result: Option<PrivateLadyResult>,
    pub can_start_assassination: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub early_assassination: Option<AssassinationBallot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assassin_candidates: Option<Vec<PlayerId>>,
    pub outcome: Option<GameOutcome>,
    pub is_spectator: bool,
    pub game_id: Option<String>,
}
