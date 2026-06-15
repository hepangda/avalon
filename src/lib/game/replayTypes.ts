import type { GameOutcome, Role, Team, VoteValue, MissionCard } from '@/lib/engine';

/**
 * Shape returned by GET /api/games/:id/replay and consumed by the replay page.
 * Mission cards (who played what) are included here — only ever exposed
 * post-game, never during play.
 */
export interface ReplayPlayer {
  id: string;
  name: string;
  seat: number;
}

export interface ReplayVote {
  proposalIndex: number;
  playerId: string;
  value: VoteValue;
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
}

export interface ReplayData {
  gameId: string;
  outcome: GameOutcome | null;
  roleAssignments: ReplayRoleAssignment[];
  players: ReplayPlayer[];
  rounds: ReplayRound[];
  ladyChecks: ReplayLadyCheck[];
  assassination: ReplayAssassination | null;
}
