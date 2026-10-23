import { teamOf } from '@/lib/engine';
import type { ReplayData } from '@/lib/game/replayTypes';
import type { PublicRating, RatingTitle, UnratedReason } from '@/lib/game/historyTypes';
import type { GameRecord } from './game-records';

export interface RatingPolicy {
  /** Enabled only by the server's development environment, never by request parameters. */
  includeBots?: boolean;
}
function participantAccount(game: GameRecord, playerId: string): string | undefined {
  // Bots have no OAuth identity. Keep their model parameters separate from real accounts.
  return game.replay.players.find(p => p.id === playerId)?.isBot
    ? JSON.stringify(['local-rating-bot', playerId])
    : game.seats[playerId];
}
export const RATING_VERSION = 'bt-map-v1-1800';
const SCALE = 400 / Math.log(10);
export const frontScore = (hidden: number, games: number) => 1000 + (1 - 0.94 ** games) * (hidden - 1000);
export function exclusion(game: GameRecord, policy: RatingPolicy = {}): UnratedReason | null {
  const { replay: r } = game;
  if (!policy.includeBots && r.players.some(p => p.isBot)) return 'bots';
  if ((game.altered === null || !r.options) && game.ratingImport !== 'name-recovery-v1') return 'legacy';
  if (game.altered) return 'altered';
  const accounts = r.players.map(p => participantAccount(game, p.id));
  if (accounts.some(a => !a) || new Set(accounts).size !== accounts.length) return 'identity';
  if (r.players.length < 5 || r.players.length > 10 || r.roleAssignments.length !== r.players.length ||
    new Set(r.roleAssignments.map(p => p.playerId)).size !== r.players.length ||
    r.players.some(p => !r.roleAssignments.some(a => a.playerId === p.id))) return 'invalid';
  const good = r.roleAssignments.filter(p => teamOf(p.role) === 'good').length;
  if (good === 0 || good === r.players.length) return 'invalid';
  return null;
}
function configuration(r: ReplayData): string {
  return JSON.stringify([r.roleAssignments.map(a => a.role).sort(), r.options ? 'known-rules' : 'legacy-unknown-rules', r.options ? !!r.options.ladyOfTheLake : null, r.options ? r.options.maxRejections ?? 5 : null]);
}
// Cholesky factorization and triangular solves preserve the full joint covariance.
function factor(a: number[][]): number[][] {
  const l = a.map(row => row.map(() => 0));
  for (let i = 0; i < a.length; i++) for (let j = 0; j <= i; j++) {
    let s = a[i]![j]!;
    for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
    if (i === j && s <= 0) throw new Error('Rating Hessian is not positive definite');
    l[i]![j] = i === j ? Math.sqrt(s) : s / l[j]![j]!;
  }
  return l;
}
function solve(l: number[][], b: number[]): number[] {
  const x = [...b];
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < i; j++) x[i]! -= l[i]![j]! * x[j]!;
    x[i]! /= l[i]![i]!;
  }
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < x.length; j++) x[i]! -= l[j]![i]! * x[j]!;
    x[i]! /= l[i]![i]!;
  }
  return x;
}
export interface RatedPlayer {
  hidden: number;
  sd: number;
  games: number;
  lastPlayed: number;
}
/**
 * Average-team Bradley–Terry MAP fit: P(good wins) = sigmoid(β₀ + u_config + mean θ_good − mean θ_evil),
 * Gaussian priors 1 / 0.7 / 0.35, Newton steps with backtracking and a Laplace covariance.
 */
export function fitRatings(input: GameRecord[], policy: RatingPolicy = {}) {
  const games = input.filter(g => !exclusion(g, policy)).sort((a, b) => a.replay.gameId.localeCompare(b.replay.gameId));
  const accounts = [...new Set(games.flatMap(g => g.replay.players.map(p => participantAccount(g, p.id)!)))].sort();
  const configs = [...new Set(games.map(g => configuration(g.replay)))].sort();
  const d = accounts.length + 1 + configs.length;
  const precision = Array.from({ length: d }, (_, i) => i < accounts.length ? 1 : i === accounts.length ? 1 / 0.7 ** 2 : 1 / 0.35 ** 2);
  const rows = games.map(g => {
    const r = g.replay;
    const good = r.roleAssignments.filter(a => teamOf(a.role) === 'good').length;
    const x: [number, number][] = r.roleAssignments.map(a => [accounts.indexOf(participantAccount(g, a.playerId)!), teamOf(a.role) === 'good' ? 1 / good : -1 / (r.players.length - good)]);
    x.push([accounts.length, 1], [accounts.length + 1 + configs.indexOf(configuration(r)), 1]);
    return { x, y: r.outcome!.winner === 'good' ? 1 : 0 };
  });
  const objective = (v: number[]) => precision.reduce((s, p, i) => s + 0.5 * p * v[i]! ** 2, 0) + rows.reduce((s, { x, y }) => {
    const z = x.reduce((sum, [i, w]) => sum + v[i]! * w, 0);
    return s + Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z))) - y * z;
  }, 0);
  let v = Array(d).fill(0) as number[];
  let h: number[][] = [];
  let converged = false;
  for (let iteration = 0; iteration < 60; iteration++) {
    const gradient = v.map((value, i) => value * precision[i]!);
    h = precision.map((p, i) => precision.map((_, j) => i === j ? p : 0));
    for (const { x, y } of rows) {
      const p = 1 / (1 + Math.exp(-x.reduce((s, [i, w]) => s + v[i]! * w, 0)));
      for (const [i, wi] of x) {
        gradient[i]! += (p - y) * wi;
        for (const [j, wj] of x) h[i]![j]! += p * (1 - p) * wi * wj;
      }
    }
    if (Math.max(...gradient.map(Math.abs)) < 1e-8) { converged = true; break; }
    const step = solve(factor(h), gradient);
    let rate = 1;
    const before = objective(v);
    while (rate > 1e-8 && objective(v.map((value, i) => value - rate * step[i]!)) > before) rate /= 2;
    v = v.map((value, i) => value - rate * step[i]!);
  }
  if (!converged) throw new Error('Rating fit did not converge');
  const l = factor(h);
  const covariance = v.map((_, i) => solve(l, v.map((__, j) => i === j ? 1 : 0)));
  const players = new Map<string, RatedPlayer>(accounts.map((account, i) => {
    const played = games.filter(g => g.replay.players.some(p => participantAccount(g, p.id) === account));
    return [account, { hidden: 1800 + SCALE * v[i]!, sd: Math.sqrt(covariance[i]![i]!), games: played.length,
      lastPlayed: Math.max(0, ...played.map(g => g.replay.endedAt ?? 0)) }];
  }));
  return { players, covariance, parameters: v, accounts, configs, version: RATING_VERSION };
}
const TITLES: RatingTitle[] = ['beginner', 'learning', 'capable', 'expert', 'master'];
/** The only projection of a fit that leaves the server. */
export function publicRating(player: RatedPlayer | undefined, now = Date.now()): PublicRating {
  if (!player) return { score: 1000, ratedGames: 0, title: 'observing', confidence: 'insufficient' };
  const { hidden, sd, games, lastPlayed } = player;
  const tier = hidden < 1600 ? 0 : hidden < 1750 ? 1 : hidden < 1850 ? 2 : hidden < 2000 ? 3 : 4;
  return { score: Math.round(frontScore(hidden, games)), ratedGames: games,
    title: sd > 0.8 ? 'observing' : TITLES[tier]!,
    confidence: now - lastPlayed > 90 * 86400000 ? 'stale' : sd > 0.8 ? 'insufficient' : sd > 0.6 ? 'tentative' : 'supported' };
}
