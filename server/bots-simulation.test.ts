import { describe, expect, it } from 'vitest';
import { simulateBotGame } from './test-bot-simulation';

describe('bot simulations', () => {
  it('replays the same match deterministically', () => {
    const first = simulateBotGame(10, 'reproducible', { mordred: true, oberon: true, ladyOfTheLake: true });
    const second = simulateBotGame(10, 'reproducible', { mordred: true, oberon: true, ladyOfTheLake: true });
    expect(second.state).toEqual(first.state);
    expect(second.metrics).toEqual(first.metrics);
  });
});
