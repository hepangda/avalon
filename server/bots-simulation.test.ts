import { describe, expect, it } from 'vitest';
import type { GameOptions } from '@/lib/engine';
import { simulateBotGame } from './test-bot-simulation';

export function simulateBots(count: number, seed: string) {
  return simulateBotGame(count, seed).metrics;
}

describe('bot simulations', () => {
  it('finishes seeded games across supported room sizes', () => {
    for (const count of [5, 6, 7, 8, 9, 10]) {
      const totals = { proposals: 0, missions: 0, forced: 0, straightFails: 0, goodMissions: 0, rejectionLoss: 0 };
      for (let i = 0; i < 50; i++) {
        const result = simulateBots(count, `benchmark:${count}:${i}`);
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(result[key]);
      }
      console.log(count, totals);
      // Previous strategy: 15–39 straight triple failures per 50 games.
      expect(totals.straightFails).toBeLessThan(10);
      expect(totals.goodMissions).toBeGreaterThanOrEqual(35);
      expect(totals.rejectionLoss).toBeLessThan(5);
      // Track pace as well as mission outcomes: the old strategy reached hammer
      // on 202/1122 missions in these seeds (up to 29% in ten-player rooms).
      expect(totals.forced / totals.missions).toBeLessThan(0.12);
      expect(totals.proposals / totals.missions).toBeLessThan(2.25);
    }
  }, 120_000);

  it('finishes mixed-policy games with special roles, Lady and every rejection limit', () => {
    for (let count = 5; count <= 10; count++) {
      const variants: Partial<GameOptions>[] = [
        { morgana: false, percival: false, ladyOfTheLake: true },
        { morgana: false, percival: true, mordred: true, ladyOfTheLake: true },
        { morgana: false, oberon: true, ladyOfTheLake: true },
        ...(count >= 7 ? [{ morgana: false, mordred: true, oberon: true, ladyOfTheLake: true }] : []),
      ];
      for (const [variant, options] of variants.entries()) for (let limit = 1; limit <= 5; limit++) {
        const result = simulateBotGame(count, `variants:${count}:${variant}:${limit}`, { ...options, maxRejections: limit }, limit % 2 ? 'new' : 'mixed');
        expect(result.state.phase).toBe('GameOver');
        expect(result.steps).toBeLessThan(1000);
        expect(result.metrics.missions).toBeGreaterThanOrEqual(3);
      }
    }
  }, 120_000);

  it('replays the same match deterministically', () => {
    const first = simulateBotGame(10, 'reproducible', { mordred: true, oberon: true, ladyOfTheLake: true });
    const second = simulateBotGame(10, 'reproducible', { mordred: true, oberon: true, ladyOfTheLake: true });
    expect(second.state).toEqual(first.state);
    expect(second.metrics).toEqual(first.metrics);
  });
});
