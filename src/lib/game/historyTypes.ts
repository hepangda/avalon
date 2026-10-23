import type { GameOutcome, Role, Team } from '@/lib/engine';

export type RatingTitle = 'beginner' | 'learning' | 'capable' | 'expert' | 'master';
export type RatingConfidence = 'insufficient' | 'tentative' | 'supported' | 'stale';
/** Why a finished game does not count toward ratings. */
export type UnratedReason = 'bots' | 'legacy' | 'altered' | 'identity' | 'invalid';

export interface PublicRating {
  score: number;
  ratedGames: number;
  title: RatingTitle;
  confidence: RatingConfidence;
}

export interface TeamRecord {
  games: number;
  wins: number;
}

/** GET /api/history: the signed-in account's own record. */
export interface HistoryProfile {
  rating: PublicRating;
  /** Score before the latest rated games and after each, oldest first; empty before any. */
  trend: number[];
  /** Personal wins and win rate use only games with a known role. */
  total: TeamRecord;
  unresolvedGames?: number;
  teams: Record<Team, TeamRecord>;
  /** Most played first. */
  roles: Array<TeamRecord & { role: Role }>;
  /** Latest first, at most ten: whether the account won. */
  form: boolean[];
}

export interface HistoryGame {
  gameId: string;
  endedAt: number | null;
  playerCount: number;
  winner: Team;
  reason: GameOutcome['reason'];
  /** Played missions in order: true for a success. */
  missions: boolean[];
  unrated: UnratedReason | null;
  /** The signed-in account's own seat, when it played. */
  /** Confirmed attendance without a known seat; not a spectator. */
  participationOnly?: boolean;
  seat: { role: Role; variant?: number; won: boolean; delta: number | null } | null;
}

/** GET /api/history/games */
export interface HistoryGamesPage {
  games: HistoryGame[];
  total: number;
  /** Offset of the next page, or null at the end. */
  next: number | null;
}
