import type { ClientLogEntry, GameOptions, GameOutcome, Role, Team, VoteValue, MissionCard } from '@/lib/engine';

/**
 * Shape returned by GET /api/games/:id/replay and consumed by the replay page.
 * Mission cards (who played what) are included here — only ever exposed
 * post-game, never during play.
 */
export interface ReplayPlayer {
  id: string;
  name: string;
  seat: number;
  avatarUrl?: string;
  isBot?: boolean;
}

export interface ReplayVote {
  proposalIndex: number;
  playerId: string;
  value: VoteValue;
}

/** One nomination and its result. Absent in replays archived before it was recorded. */
export interface ReplayProposal {
  proposalIndex: number;
  leaderPlayerId: string;
  team: string[];
  approved: boolean;
}

export interface ReplayMissionCard {
  playerId: string;
  card: MissionCard;
}

export interface ReplayRound {
  roundIndex: number;
  leaderPlayerId: string;
  teamSize: number;
  finalTeam: string[] | null;
  approved: boolean | null;
  missionSuccess: boolean | null;
  failCount: number | null;
  votes: ReplayVote[];
  proposals?: ReplayProposal[];
  missionCards: ReplayMissionCard[];
}

export interface ReplayLadyCheck {
  roundIndex: number;
  holderPlayerId: string;
  targetPlayerId: string;
  revealedTeam: Team;
}

export interface ReplayAssassination {
  assassinPlayerId: string;
  targetPlayerId: string;
  hitMerlin: boolean;
}

export interface ReplayRoleAssignment {
  playerId: string;
  role: Role;
  roleVariant?: number;
}

export interface ReplayData {
  gameId: string;
  outcome: GameOutcome | null;
  roleAssignments: ReplayRoleAssignment[];
  players: ReplayPlayer[];
  rounds: ReplayRound[];
  ladyChecks: ReplayLadyCheck[];
  assassination: ReplayAssassination | null;
  /** Fields below are absent in replays archived before they were recorded. */
  options?: GameOptions;
  startedAt?: number;
  endedAt?: number;
  /** Public table log, in order. */
  log?: ClientLogEntry[];
}

/** GET /api/games/:id/replay: the record and the seat the signed-in account held, if any. */
export interface ReplayView {
  replay: ReplayData;
  viewerId: string | null;
}
