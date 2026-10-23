import { describe, expect, it } from 'vitest';
import { exclusion, fitRatings, frontScore, publicRating } from './ratings';
import { record } from './test-records';

describe('ratings', () => {
  it('starts at 1000, approaches each hidden score, and permits early loss gains', () => {
    expect(frontScore(1800, 0)).toBe(1000);
    expect(Math.round(frontScore(1800, 10))).toBe(1369);
    expect(frontScore(1760, 11)).toBeGreaterThan(frontScore(1800, 10));
    expect(frontScore(2100, 1000)).toBeCloseTo(2100);
    expect(frontScore(900, 10)).toBeLessThan(1000);
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
  it.each(['bots', 'legacy', 'altered', 'identity', 'invalid'] as const)('excludes %s from the model', reason => {
    const g = record();
    if (reason === 'bots') g.replay.players[0]!.isBot = true;
    if (reason === 'legacy') g.altered = null;
    if (reason === 'altered') g.altered = true;
    if (reason === 'identity') delete g.seats.p0;
    if (reason === 'invalid') g.replay.roleAssignments.pop();
    expect(exclusion(g)).toBe(reason);
    expect(fitRatings([g]).players.size).toBe(0);
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
    expect(publicRating(undefined)).toEqual({ score: 1000, ratedGames: 0, title: 'beginner', confidence: 'insufficient' });
  });
});
