/**
 * Avalon game engine — core types.
 *
 * This module is pure: it imports nothing from Next/Socket.IO/Prisma/Node.
 * The engine is a synchronous, deterministic reducer over plain serializable
 * state. Randomness and time are injected via EngineContext so that replays
 * are reproducible.
 */

// ---------------------------------------------------------------------------
// Identifiers & primitives
// ---------------------------------------------------------------------------

export type PlayerId = string;

export type Team = 'good' | 'evil';

export type Role =
  // good
  | 'Merlin'
  | 'Percival'
  | 'LoyalServant'
  // evil
  | 'Morgana'
  | 'Assassin'
  | 'Oberon'
  | 'Mordred'
  | 'Minion';

export type VoteValue = 'approve' | 'reject';
export type MissionCard = 'success' | 'fail';

export type GamePhase =
  | 'Lobby'
  | 'RoleReveal'
  | 'TeamBuilding'
  | 'TeamAnnouncement'
  | 'Discussion'
  | 'TeamFinalizing'
  | 'Voting'
  | 'MissionVote'
  | 'MissionResult'
  | 'LadyOfLake'
  | 'Assassination'
  | 'GameOver';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Optional roles & modules the host can toggle when creating a game. */
export interface GameOptions {
  oberon: boolean;
  mordred: boolean;
  morgana: boolean;
  percival: boolean;
  ladyOfTheLake: boolean;
  /** Consecutive rejected proposals before evil wins (1–5); omitted in legacy games = 5. */
  maxRejections?: number;
  /** Per-player speaking time in seconds; defaults to 120. Reminder only. */
  speechSeconds?: number;
}

export interface GameConfig {
  playerCount: number;
  options: GameOptions;
  /** The exact multiset of roles in play, derived from playerCount + options. */
  roles: Role[];
}

// ---------------------------------------------------------------------------
// Player & state
// ---------------------------------------------------------------------------

export interface PlayerSlot {
  id: PlayerId;
  name: string;
  /** Seating index 0..n-1; leader rotation walks this order. */
  seat: number;
  role: Role;
  connected: boolean;
}

export interface MissionOutcome {
  roundIndex: number;
  teamSize: number;
  team: PlayerId[];
  success: boolean;
  failCount: number;
  /** Per-player cards (server-only; surfaced only in post-game replay). */
  cards: Record<PlayerId, MissionCard>;
}

export type WinReason =
  | 'three_missions'
  | 'five_rejections'
  | 'rejection_limit'
  | 'assassinated_merlin'
  | 'assassin_missed';

export interface RevealedRole {
  playerId: PlayerId;
  role: Role;
  team: Team;
}

export interface GameOutcome {
  winner: Team;
  reason: WinReason;
  missionTally: { good: number; evil: number };
  assassinTargetId?: PlayerId;
  revealedRoles: RevealedRole[];
}

/**
 * A completed team-vote (one proposal). Recorded for every proposal — approved
 * or rejected — so the full voting history is replayable in-game.
 */
export interface VoteRecord {
  roundIndex: number;
  /** 0-based index of the proposal within the round (rises on each rejection). */
  proposalIndex: number;
  leaderId: PlayerId;
  team: PlayerId[];
  votes: Record<PlayerId, VoteValue>;
  approved: boolean;
}

/**
 * A structured system-log entry. Rendered client-side from an i18n key + params
 * so it shows in each viewer's locale. Public entries go to everyone; private
 * entries (audience set) go only to that player. Accumulated in GameState so
 * the full history survives reconnects.
 */
export interface LogEntry {
  seq: number;
  roundIndex: number;
  /** Wall-clock time the event occurred (ms epoch), injected via EngineContext. */
  at: number;
  channel: 'public' | 'private';
  /** For private entries: the only player who may see it. */
  audience?: PlayerId;
  /** i18n message key under "log.*". */
  key: string;
  /** Params interpolated into the message (names resolved client-side). */
  params?: Record<string, string | number>;
  /** Visual style hint. Referee actions are red. */
  style?: 'admin';
}

/**
 * Full authoritative game state. Lives in server memory. Plain & serializable
 * (no Map/class instances) so it can be snapshotted/cloned/persisted.
 */
export interface GameState {
  phase: GamePhase;
  /** Replay rules: v1 has no discussion, v2 confirms announcements, v2–3 speak leader-first; v5 adds timed explanation and direction. */
  flowVersion?: 1 | 2 | 3 | 4 | 5;
  discussion?: DiscussionState | null;
  actionTimers?: ActionTimer[];
  config: GameConfig;
  seed: string;
  players: PlayerSlot[];

  roundIndex: number; // 0..4 → mission 1..5
  leaderIndex: number; // seat index of current leader
  rejectionCount: number; // consecutive rejected proposals this round (0..5)

  proposedTeam: PlayerId[] | null;
  teamChanged?: boolean;
  votes: Record<PlayerId, VoteValue>; // accumulating; empty between Voting phases
  /** Server-only: never projected to any client. */
  missionCards: Record<PlayerId, MissionCard>;
  missionResults: MissionOutcome[];
  /** Every completed proposal vote (approved or rejected), in order. */
  voteHistory: VoteRecord[];
  /** System log entries (public + private), accumulated for reconnect. */
  logs: LogEntry[];
  /** Monotonic counter for log entry seq. */
  logSeq: number;

  /** Players who have acknowledged seeing their role (RoleReveal gate). */
  roleAcks: PlayerId[];

  // Lady of the Lake
  ladyEnabled: boolean;
  ladyHolderId: PlayerId | null;
  ladyInspectedIds: PlayerId[];
  pendingLady: boolean;
  /** Last inspection result, surfaced privately to the holder only. */
  lastLadyResult: {
    holderId: PlayerId;
    targetId: PlayerId;
    loyalty: Team;
  } | null;

  assassinId: PlayerId | null;
  outcome: GameOutcome | null;
  /** Server-only checkpoints for referee rollback; never sent to viewers. */
  phaseHistory?: PhaseCheckpoint[];
  phaseRevision?: number;
  /** Once play begins, opening-only referee actions stay closed even after rollback. */
  openingClosed?: boolean;
  /** Increments on a redeal so acknowledgements of old identities are rejected. */
  roleRevision?: number;
}

export type PhaseCheckpoint = Pick<
  GameState,
  | 'phase'
  | 'roundIndex'
  | 'leaderIndex'
  | 'rejectionCount'
  | 'teamChanged'
  | 'proposedTeam'
  | 'discussion'
  | 'votes'
  | 'missionCards'
  | 'missionResults'
  | 'voteHistory'
  | 'ladyHolderId'
  | 'ladyInspectedIds'
  | 'pendingLady'
  | 'lastLadyResult'
  | 'outcome'
>;

// ---------------------------------------------------------------------------
// Visibility (what a viewer learns at RoleReveal)
// ---------------------------------------------------------------------------

export type ShownAs = 'evil' | 'merlin-or-morgana' | 'known-ally';

export interface VisibilityInfo {
  playerId: PlayerId;
  shownAs: ShownAs;
  certain: boolean;
  /** Exact identity is sent only to known red teammates (never to Merlin or Percival). */
  role?: Role;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'START_GAME'; by: PlayerId; flowVersion?: 1 | 2 | 3 | 4 | 5; assignedRoles?: Role[] }
  | { type: 'ACK_ROLE'; by: PlayerId; roleRevision?: number }
  | { type: 'REROLL_LEADER'; actor: string }
  | { type: 'REROLL_ROLES'; actor: string; assignedRoles?: Role[] }
  | { type: 'USE_REROLL_CARD'; by: PlayerId; roleRevision: number; assignedRoles?: Role[] }
  | { type: 'PROPOSE_TEAM'; by: PlayerId; team: PlayerId[]; admin?: boolean }
  | { type: 'START_DISCUSSION'; by: PlayerId; direction?: 'clockwise' | 'counterclockwise' }
  | { type: 'END_SPEECH'; by: PlayerId }
  | { type: 'SKIP_SPEECH'; target: PlayerId; actor: string }
  | { type: 'SET_TIMERS_PAUSED'; paused: boolean; actor: string }
  | { type: 'FINALIZE_TEAM'; by: PlayerId; team: PlayerId[]; admin?: boolean }
  | { type: 'CAST_VOTE'; by: PlayerId; value: VoteValue; admin?: boolean }
  | { type: 'RETRACT_VOTES' }
  | { type: 'RETRACT_PROPOSAL' }
  | { type: 'CAST_MISSION_CARD'; by: PlayerId; card: MissionCard }
  | { type: 'USE_LADY'; by: PlayerId; target: PlayerId }
  | {
      type: 'START_ASSASSINATION';
      by: PlayerId;
      admin?: boolean;
      actor?: string;
    }
  | { type: 'PREVIOUS_PHASE'; actor: string }
  | { type: 'ASSASSINATE'; by: PlayerId; target: PlayerId }
  | { type: 'SET_CONNECTED'; by: PlayerId; connected: boolean };

// ---------------------------------------------------------------------------
// Effects (declarative; interpreted by the Socket layer, never by the engine)
// ---------------------------------------------------------------------------

export type CheckpointKind =
  'game_started' | 'vote' | 'mission_result' | 'lady' | 'game_over';

export type Effect =
  | { kind: 'PERSIST_CHECKPOINT'; checkpoint: CheckpointKind }
  | {
      kind: 'PRIVATE_LADY';
      holderId: PlayerId;
      targetId: PlayerId;
      loyalty: Team;
    };

// ---------------------------------------------------------------------------
// Engine context & results
// ---------------------------------------------------------------------------

export interface RNG {
  next(): number; // [0,1)
  shuffle<T>(xs: readonly T[]): T[];
}

export interface EngineContext {
  now: number;
  rng: RNG;
}

export type EngineErrorCode =
  | 'WRONG_PHASE'
  | 'NOT_HOST'
  | 'NOT_LEADER'
  | 'NOT_SPEAKER'
  | 'NOT_ASSASSIN'
  | 'NOT_LADY_HOLDER'
  | 'UNKNOWN_PLAYER'
  | 'INVALID_PLAYER_COUNT'
  | 'INVALID_ROLE_SET'
  | 'WRONG_TEAM_SIZE'
  | 'INVALID_DIRECTION'
  | 'INVALID_TEAM_MEMBER'
  | 'DUPLICATE_TEAM_MEMBER'
  | 'ALREADY_VOTED'
  | 'ALREADY_PLAYED_CARD'
  | 'NOT_ON_TEAM'
  | 'GOOD_CANNOT_FAIL'
  | 'LADY_TARGET_SELF'
  | 'LADY_TARGET_INSPECTED'
  | 'ASSASSIN_TARGET_INVALID';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type EngineResult =
  | { ok: true; state: GameState; effects: Effect[] }
  | { ok: false; error: EngineError };

// ---------------------------------------------------------------------------
// Client-facing projection
// ---------------------------------------------------------------------------

export interface ClientPlayer {
  isBot?: boolean;
  id: PlayerId;
  name: string;
  /** OAuth profile picture copied from room membership by the socket layer. */
  avatarUrl?: string;
  seat: number;
  connected: boolean;
  /** Self-measured round-trip latency in ms. Filled by the socket layer (the
   *  pure engine has no notion of latency); undefined until first ping. */
  latency?: number;
  /** Whether a live participant holds this seat. Filled by the socket layer
   *  (the engine has no notion of claiming). An unclaimed seat is open for a
   *  joiner to take; a claimed-but-disconnected seat is held for reconnect. */
  claimed?: boolean;
  /** Self's role, all evil roles during Assassination, or everyone's at GameOver. */
  role?: Role;
  /** Cosmetic variant; projected only when this player's role is visible. */
  roleVariant?: number;
  isLeader: boolean;
  isLadyHolder: boolean;
}

export interface ClientVote {
  playerId: PlayerId;
  hasVoted: boolean;
  vote?: VoteValue; // revealed only after all votes are in
}

export interface ClientMissionResult {
  roundIndex: number;
  success: boolean;
  failCount: number;
  teamSize: number;
}

/** A completed proposal vote, surfaced to clients for the in-game history. */
export interface ClientVoteRecord {
  roundIndex: number;
  proposalIndex: number;
  leaderId: PlayerId;
  team: PlayerId[];
  votes: Array<{ playerId: PlayerId; vote: VoteValue }>;
  approved: boolean;
}

/** A log entry as delivered to a client (audience stripped by projection). */
export interface ClientLogEntry {
  seq: number;
  roundIndex: number;
  at: number;
  channel: 'public' | 'private';
  key: string;
  params?: Record<string, string | number>;
  style?: 'admin';
}

export interface DiscussionState {
  order: PlayerId[];
  speakerIndex: number;
}

export type TimedAction = 'role' | 'propose' | 'announce' | 'speak' | 'finalize' | 'vote' | 'mission' | 'lady' | 'assassinate';

/** Public pending-action metadata; never contains votes, cards, or private identities. */
export interface ActionTimer {
  playerId: PlayerId;
  action: TimedAction;
  startedAt: number;
  durationMs: number;
  /** Freeze at this server timestamp until resumed; omitted while running. */
  pausedAt?: number;
}

export interface ClientGameState {
  phase: GamePhase;
  discussion?: DiscussionState | null;
  actionTimers?: ActionTimer[];
  /** Stamped by the room, used to compensate for the client's wall-clock offset. */
  serverTime?: number;
  previousPhase?: GamePhase;
  phaseRevision?: number;
  roleRevision: number;
  /** Availability only; the room layer separately enforces referee authorization. */
  canRerollOpening: boolean;
  roundIndex: number;
  leaderIndex: number;
  rejectionCount: number;
  players: ClientPlayer[];
  selfRole: Role | null;
  knownPlayers: VisibilityInfo[];
  /** Players who have acknowledged their role. The client shows the role-reveal
   *  overlay while the viewer's own id is absent from this list. */
  roleAcks: PlayerId[];
  proposedTeam: PlayerId[] | null;
  teamChanged?: boolean;
  votes: ClientVote[] | null;
  /** Public submission markers only. Never includes the value of a mission card. */
  missionSubmissions: PlayerId[];
  missionResults: ClientMissionResult[];
  voteHistory: ClientVoteRecord[];
  logs: ClientLogEntry[];
  config: {
    playerCount: number;
    missionSizes: number[];
    requiredFails: number[];
    rolesInPlay: Role[];
    maxRejections?: number;
    speechSeconds?: number;
  };
  lady: {
    holderId: PlayerId | null;
    inspectedIds: PlayerId[];
    pending: boolean;
  } | null;
  privateLadyResult?: { targetId: PlayerId; loyalty: Team };
  /** Whether this viewer is the assassin and may end normal play immediately. */
  canStartAssassination: boolean;
  assassinCandidates?: PlayerId[]; // populated only for the assassin during Assassination
  outcome: GameOutcome | null;
  isSpectator: boolean;
  /**
   * DB game id, stamped by the socket layer (the pure engine leaves it null).
   * Lets the client link to the replay once the game is over.
   */
  gameId: string | null;
}
