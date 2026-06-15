import type {
  ClientGameState,
  GameOptions,
  GameState,
  PlayerId,
  Role,
  Team,
  VisibilityInfo,
} from '@/lib/engine';

/**
 * Room-level configuration the host sets in the lobby. Superset of engine
 * GameOptions plus room policies (spectators, mid-join, max players).
 */
export interface RoomConfig {
  maxPlayers: number;
  allowSpectators: boolean;
  allowMidJoin: boolean;
  options: GameOptions;
  /** Host-defined roster: the name of each seat, seat 0..roster.length-1. */
  roster: string[];
}

export type RoomStatus = 'lobby' | 'in_game' | 'finished';

/** A lobby/seated member as tracked in the room (pre-game and during game). */
export interface RoomMember {
  id: PlayerId;
  name: string;
  seat: number;
  isSpectator: boolean;
  connected: boolean;
  /** A live participant has taken this roster seat. claimed=false → empty seat
   *  anyone may claim. Independent of `connected` (the socket liveness). */
  claimed: boolean;
  /** Last self-measured round-trip latency in ms (undefined until first ping). */
  latency?: number;
}

/**
 * Public room snapshot for the lobby (no roles — game hasn't dealt yet, or
 * roles are private). Sent to everyone in the room.
 */
export interface RoomSnapshot {
  code: string;
  hostPlayerId: PlayerId;
  status: RoomStatus;
  config: RoomConfig;
  members: RoomMember[];
}

/**
 * In-memory runtime for a single room. Authoritative. Lives in the GameStore
 * map keyed by room code. The engine GameState (if a game is running) is the
 * source of game truth; everything else is socket/room bookkeeping.
 */
export interface RoomRuntime {
  code: string;
  roomId: string; // DB Room.id
  hostPlayerId: PlayerId;
  status: RoomStatus;
  config: RoomConfig;
  members: Map<PlayerId, RoomMember>;
  /** Live socket id per player (for targeted private emits). */
  socketByPlayer: Map<PlayerId, string>;
  /** Sockets attached to the room without a claimed seat (spectators/unseated).
   *  They receive the spectator-projected state. */
  spectatorSockets: Set<string>;
  /** Engine state when a game is in progress; null in lobby. */
  game: GameState | null;
  /** DB Game.id for the active game; null in lobby. */
  gameId: string | null;
  /** Monotonic event sequence for the active game's event log. */
  eventSeq: number;
  /** Serializes all DB persistence for this room so checkpoints never race. */
  persistChain: Promise<void>;
}

// ---------------------------------------------------------------------------
// Socket payload contracts (client ⇄ server)
// ---------------------------------------------------------------------------

export type VoteValue = 'approve' | 'reject';
export type MissionCard = 'success' | 'fail';

export interface Ack<T = undefined> {
  ok: boolean;
  error?: { code: string; message: string };
  data?: T;
}

/** Events the client emits. The third arg is always an ack callback. */
export interface ClientToServerEvents {
  'room:join': (
    p: { code: string; playerId?: PlayerId; hostToken?: string },
    ack: (r: Ack<{ playerId?: PlayerId; isHost: boolean }>) => void,
  ) => void;
  'room:leave': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'room:config': (p: { config: RoomConfig }, ack: (r: Ack) => void) => void;
  'room:rename': (p: { name: string }, ack: (r: Ack<{ name: string }>) => void) => void;
  'room:kick': (p: { targetPlayerId: PlayerId }, ack: (r: Ack) => void) => void;
  'room:transferHost': (p: { targetPlayerId: PlayerId }, ack: (r: Ack) => void) => void;
  'room:start': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  /** Claim a roster seat by its player id (must be unclaimed). Switches seats
   *  if the caller already holds one. */
  'room:claimSeat': (p: { seatId: PlayerId }, ack: (r: Ack<{ playerId: PlayerId }>) => void) => void;
  /** Release the caller's current seat (becomes a spectator / unseated). */
  'room:releaseSeat': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  /** Host edits the roster (lobby only): the full ordered list of seat names. */
  'room:setRoster': (p: { names: string[] }, ack: (r: Ack) => void) => void;
  'game:ackRole': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'game:proposeTeam': (p: { team: PlayerId[] }, ack: (r: Ack) => void) => void;
  'game:vote': (p: { value: VoteValue }, ack: (r: Ack) => void) => void;
  'game:missionCard': (p: { card: MissionCard }, ack: (r: Ack) => void) => void;
  'game:useLady': (p: { targetPlayerId: PlayerId }, ack: (r: Ack) => void) => void;
  'game:assassinate': (p: { targetPlayerId: PlayerId }, ack: (r: Ack) => void) => void;
  /**
   * Latency heartbeat. The client measures round-trip time by timing the ack,
   * and reports the previous measurement back so the server can share each
   * player's self-measured latency with the rest of the room.
   */
  'net:ping': (p: { rtt?: number }, ack: (r: Ack) => void) => void;
  // -------------------------------------------------------------------------
  // Referee (admin) actions. Authorized per-socket — anyone may enable the
  // referee panel; there is no password. The server performs every "act as
  // player" action itself, so the operator's client never assumes the target's
  // identity and never receives the target's private role/vision.
  // -------------------------------------------------------------------------
  /** Enable referee powers for this socket. Logs an "opened panel" notice. */
  'admin:auth': (p: Record<string, never>, ack: (r: Ack<{ ok: boolean }>) => void) => void;
  /** Drop this socket's admin power (logs a public notice). */
  'admin:close': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  /** Unbind a player from their seat (frees it for re-claim; full history is
   *  restored to whoever claims it next). Admin only. */
  'admin:unbind': (p: { targetPlayerId: PlayerId }, ack: (r: Ack) => void) => void;
  /** Cast (or overwrite) a vote on behalf of a player. Admin only. */
  'admin:vote': (p: { targetPlayerId: PlayerId; value: VoteValue }, ack: (r: Ack) => void) => void;
  /** Propose the mission team on behalf of the current leader. Admin only. */
  'admin:propose': (p: { targetPlayerId: PlayerId; team: PlayerId[] }, ack: (r: Ack) => void) => void;
  /** Clear all cast votes for the current proposal (before it resolves). Admin only. */
  'admin:retractVotes': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  /** Cancel the current proposal and return to TeamBuilding for a re-proposal. Admin only. */
  'admin:retractProposal': (p: Record<string, never>, ack: (r: Ack) => void) => void;
}

/** Events the server emits. */
export interface ServerToClientEvents {
  'state:sync': (state: ClientGameState) => void;
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'private:reveal': (p: { selfRole: Role; knownPlayers: VisibilityInfo[] }) => void;
  'private:lady': (p: { targetId: PlayerId; loyalty: Team }) => void;
  'system:notice': (p: { type: string; message?: string }) => void;
  error: (p: { code: string; message: string }) => void;
}

export interface SocketData {
  playerId?: PlayerId;
  code?: string;
  /** True if this socket authenticated as the room owner via hostToken. */
  isHost?: boolean;
  /** True if this socket authenticated with the room super-password (referee
   *  powers). Per-socket, not persisted — a refresh clears it. */
  isAdmin?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}
