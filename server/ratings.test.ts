import { describe, expect, it } from 'vitest';
import { exclusion, fitRatings, deviationScore, publicRating } from './ratings';
import { record } from './test-records';

describe('ratings', () => {
  it('maps hidden skill to a fixed deviation scale without clamping', () => {
    expect([1400, 1600, 1800, 2000, 2200].map(deviationScore)).toEqual([30, 40, 50, 60, 70]);
    expect(deviationScore(1825)).toBe(51.3);
    expect(deviationScore(700)).toBe(-5);
    expect(deviationScore(2900)).toBe(105);
  });
  it('does not award growth points and reflects losses immediately', () => {
    const player = { hidden: 1800, sd: 0.5, games: 0, lastPlayed: 1 };
    expect([0, 10, 60, 1000].map(games => publicRating({ ...player, games }).score)).toEqual([50, 50, 50, 50]);
    expect(publicRating(fitRatings([record('loss', 'evil')]).players.get('account0')).score).toBeLessThan(50);
    expect(publicRating(fitRatings([record()]).players.get('account0')).score).toBeGreaterThan(50);
  });
  it('uses the final outcome even for early assassination and rewards no activity in hidden skill', () => {
    const good = fitRatings([record()]);
    const evil = fitRatings([record('one', 'evil')]);
    expect(good.players.get('account0')!.hidden).toBeGreaterThan(1800);
    expect(evil.players.get('account0')!.hidden).toBeLessThan(1800);
    expect(good.players.get('account0')!.hidden + evil.players.get('account0')!.hidden).toBeCloseTo(3600);
  });
  it('is independent of input order and retains unidentifiable teammate contrasts', () => {
    const games = Array.from({ length: 100 }, (_, i) => record(String(i)));
    const a = fitRatings(games), b = fitRatings([...games].reverse());
    expect(a.parameters).toEqual(b.parameters);
    expect(a.covariance[0]![0]! + a.covariance[1]![1]! - 2 * a.covariance[0]![1]!).toBeCloseTo(2, 8);
  });
  it.each(['bots', 'legacy', 'identity', 'invalid'] as const)('excludes %s from the model', reason => {
    const g = record();
    if (reason === 'bots') g.replay.players[0]!.isBot = true;
    if (reason === 'legacy') g.altered = null;
    if (reason === 'identity') delete g.seats.p0;
    if (reason === 'invalid') g.replay.roleAssignments.pop();
    expect(exclusion(g)).toBe(reason);
    expect(fitRatings([g]).players.size).toBe(0);
  });
  it('rates altered archives identically to ordinary games using their final result', () => {
    for (const winner of ['good', 'evil'] as const) {
      const game = record('altered', winner);
      const ordinary = fitRatings([game]);
      game.altered = true;
      expect(exclusion(game)).toBeNull();
      expect(fitRatings([game]).players).toEqual(ordinary.players);
      delete game.seats.p0;
      expect(exclusion(game)).toBe('identity');
    }
  });
  it('rates local bot games under their own identities when the policy allows it', () => {
    const g = record();
    for (const player of g.replay.players.slice(1)) {
      player.isBot = true;
      delete g.seats[player.id];
    }
    const original = structuredClone(g);
    expect(exclusion(g)).toBe('bots');
    expect(exclusion(g, { includeBots: true })).toBeNull();
    const fit = fitRatings([g], { includeBots: true });
    expect(fit.players.size).toBe(5);
    expect(fit.players.get('account0')!.hidden).toBeGreaterThan(1800);
    expect(g).toEqual(original);
  });
  it('projects only the public score, title and confidence', () => {
    const value = publicRating(fitRatings([record()]).players.get('account0'));
    expect(Object.keys(value).sort()).toEqual(['confidence', 'ratedGames', 'score', 'title']);
    expect(value.title).toBe('capable');
    expect(publicRating(undefined)).toEqual({ score: 50, ratedGames: 0, title: 'beginner', confidence: 'insufficient' });
  });
});
