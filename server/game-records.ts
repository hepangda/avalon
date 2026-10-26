import { teamOf, type Role } from '@/lib/engine';
import type { HistoryGame, HistoryGamesPage, HistoryProfile, SeatRecord, TeamRecord } from '@/lib/game/historyTypes';
import type { ReplayData } from '@/lib/game/replayTypes';
import type { Persistence, RoomDocument } from './persistence';
import { exclusion, fitRatings, INITIAL_PUBLIC_SCORE, publicRating, type RatingPolicy } from './ratings';

/** An archived game with its private seat links. The links themselves never leave the server. */
export interface GameRecord {
  replay: ReplayData;
  /** Player id → account, for every seat a signed-in account held. */
  seats: Record<string, string>;
  /** Settlement proves attendance, even when the historical seat is unknown. Private. */
  participants?: string[];
  /** Explicit, audited operator approval for otherwise incomplete legacy rating metadata. */
  ratingImport?: 'name-recovery-v1';
  /** A rewind, reroll, retraction or referee action changed the game; null once that is no longer known. */
  altered: boolean | null;
}

const ALTERING = new Set(['PREVIOUS_PHASE', 'REROLL_ROLES', 'USE_REROLL_CARD', 'RETRACT_VOTES', 'RETRACT_PROPOSAL']);

/** Seat links of the game a room has just finished, frozen with its archive. */
export function archiveLinks(document: RoomDocument): { seats: Record<string, string>; altered: boolean } {
  return {
    seats: { ...document.gameAccounts },
    altered: document.events.some(({ event }) => ALTERING.has(event.type) || ('admin' in event && event.admin === true)),
  };
}

/**
 * Older games kept no seat links. Only a lone human seat settled to a lone account maps
 * unambiguously; anything else stays unlinked rather than being guessed from nicknames.
 */
export function legacySeatLink(replay: ReplayData, settledAccounts: string[]): Record<string, string> | null {
  const humans = replay.players.filter((player) => !player.isBot);
  const accounts = [...new Set(settledAccounts.filter(Boolean))];
  return humans.length === 1 && accounts.length === 1 ? { [humans[0]!.id]: accounts[0]! } : null;
}

/** Production history and direct replay access share the same bot visibility policy. */
export function visibleReplay(replay: ReplayData, policy: RatingPolicy): boolean {
  return !!policy.includeBots || !replay.players.some(player => player.isBot);
}

const PAGE = 30;
const ended = (r: ReplayData) => r.endedAt ?? r.startedAt ?? 0;

/** Every finished game and the rating fit over them, rebuilt whenever the archive changes. */
class RecordBook {
  readonly games: GameRecord[];
  /** Rated games, oldest first: the order ratings accumulate in. */
  private readonly rated: GameRecord[];
  private readonly fit: ReturnType<typeof fitRatings>;
  /** Public scores after each prefix of `rated`; a prefix is only fitted when a page needs it. */
  private readonly prefixes = new Map<number, Map<string, number>>([[0, new Map()]]);

  constructor(records: GameRecord[], readonly policy: RatingPolicy) {
    this.games = records.filter((g) => g.replay.outcome && visibleReplay(g.replay, policy))
      .sort((a, b) => ended(b.replay) - ended(a.replay) || a.replay.gameId.localeCompare(b.replay.gameId));
    this.rated = this.games.filter((g) => !exclusion(g, policy)).reverse();
    this.fit = fitRatings(this.rated, policy);
  }

  rating(account: string) {
    return publicRating(this.fit.players.get(account));
  }

  private scoresAfter(count: number) {
    let scores = this.prefixes.get(count);
    if (!scores) {
      const fit = count === this.rated.length ? this.fit : fitRatings(this.rated.slice(0, count), this.policy);
      scores = new Map([...fit.players].map(([account, player]) => [account, publicRating(player).score]));
      this.prefixes.set(count, scores);
    }
    return scores;
  }

  /**
   * The account's public score just after the game minus just before it. Movement while
   * the account sat out belongs to no game, so deltas need not sum to the current score.
   */
  delta(game: GameRecord, account: string): number | null {
    const index = this.rated.indexOf(game);
    if (index < 0) return null;
    const difference = (this.scoresAfter(index + 1).get(account) ?? INITIAL_PUBLIC_SCORE) - (this.scoresAfter(index).get(account) ?? INITIAL_PUBLIC_SCORE);
    return Math.round(difference * 10) / 10;
  }

  /** The account's score before its last `limit` rated games and after each of them, oldest first. */
  trend(account: string, limit = 20): number[] {
    const played = this.rated.flatMap((game, index) => Object.values(game.seats).includes(account) ? [index] : []).slice(-limit);
    if (!played.length) return [];
    const score = (count: number) => this.scoresAfter(count).get(account) ?? INITIAL_PUBLIC_SCORE;
    return [score(played[0]!), ...played.map((index) => score(index + 1))];
  }
}

function seatOf(game: GameRecord, account: string) {
  const playerId = Object.keys(game.seats).find((id) => game.seats[id] === account);
  return game.replay.roleAssignments.find((a) => a.playerId === playerId) ?? null;
}

function participated(game: GameRecord, account: string): boolean {
  return !!seatOf(game, account) || !!game.participants?.includes(account);
}

const books = new WeakMap<Persistence, { key: string; book: RecordBook }>();

export async function recordBook(persistence: Persistence, policy: RatingPolicy = {}): Promise<RecordBook> {
  const key = JSON.stringify([await persistence.gameRecordsVersion(), !!policy.includeBots]);
  const cached = books.get(persistence);
  if (cached?.key === key) return cached.book;
  const book = new RecordBook(await persistence.listGameRecords(), policy);
  books.set(persistence, { key, book });
  return book;
}

export function historyProfile(book: RecordBook, account: string): HistoryProfile {
  let unresolvedGames = 0;
  const total: TeamRecord = { games: 0, wins: 0 };
  const teams = { good: { games: 0, wins: 0 }, evil: { games: 0, wins: 0 } };
  const roles = new Map<Role, TeamRecord>();
  const form: boolean[] = [];
  for (const game of book.games) {
    const seat = seatOf(game, account);
    if (!seat) {
      if (participated(game, account)) unresolvedGames++;
      continue;
    }
    const team = teamOf(seat.role);
    const won = game.replay.outcome!.winner === team;
    const role = roles.get(seat.role) ?? { games: 0, wins: 0 };
    roles.set(seat.role, role);
    for (const record of [total, teams[team], role]) {
      record.games += 1;
      if (won) record.wins += 1;
    }
    if (form.length < 10) form.push(won);
  }
  return {
    rating: book.rating(account),
    trend: book.trend(account),
    total,
    unresolvedGames,
    teams,
    roles: [...roles].map(([role, record]) => ({ role, ...record }))
      .sort((a, b) => b.games - a.games || b.wins - a.wins || a.role.localeCompare(b.role)),
    form,
  };
}

/** What a tablemate may see of an account: its plate, at most three roles, and no games. */
export function seatRecord(book: RecordBook, account: string, hidden = false): SeatRecord {
  if (hidden) return { rating: book.rating(account), hidden: true };
  const { rating, total, teams, roles, form } = historyProfile(book, account);
  return { rating, total, teams, roles: roles.slice(0, 3), form };
}

export function historyGames(book: RecordBook, account: string, offset: number): HistoryGamesPage {
  const games = book.games.filter((g) => participated(g, account));
  return {
    total: games.length,
    next: offset + PAGE < games.length ? offset + PAGE : null,
    games: games.slice(offset, offset + PAGE).map((game): HistoryGame => {
      const { replay } = game;
      const seat = seatOf(game, account);
      return {
        gameId: replay.gameId,
        endedAt: replay.endedAt ?? null,
        playerCount: replay.players.length,
        winner: replay.outcome!.winner,
        reason: replay.outcome!.reason,
        missions: [...replay.rounds].sort((a, b) => a.roundIndex - b.roundIndex).flatMap((round) => round.missionSuccess === null ? [] : [round.missionSuccess]),
        unrated: exclusion(game, book.policy),
        participationOnly: !seat && participated(game, account),
        seat: seat && {
          role: seat.role,
          ...(seat.roleVariant !== undefined ? { variant: seat.roleVariant } : {}),
          won: replay.outcome!.winner === teamOf(seat.role),
          delta: book.delta(game, account),
        },
      };
    }),
  };
}
