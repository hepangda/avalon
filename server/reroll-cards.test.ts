import { describe, expect, it } from 'vitest';
import { claimDaily, completeGame, emptyCards, rewardDay } from './reroll-cards';

describe('account reroll card rewards', () => {
  it('changes day at exactly 04:00 UTC+8, including year rollover', () => {
    expect(rewardDay(Date.parse('2026-12-31T19:59:59.999Z'))).toBe('2026-12-31');
    expect(rewardDay(Date.parse('2026-12-31T20:00:00.000Z'))).toBe('2027-01-01');
  });
  it('claims once a day, without catch-up or backwards-time rewards', () => {
    const before = Date.parse('2026-09-29T19:59:59Z');
    const first = claimDaily(emptyCards(), before);
    expect(first.cards).toBe(1);
    expect(claimDaily(first, before)).toEqual(first);
    const next = claimDaily(first, before + 1000);
    expect(next.cards).toBe(2);
    expect(claimDaily(next, before)).toEqual(next);
    expect(claimDaily(emptyCards(), before + 30 * 86400000).cards).toBe(1);
  });
  it('does not bank a daily reward when the wallet is full', () => {
    const now = Date.now();
    const full = claimDaily({ ...emptyCards(), cards: 2 }, now);
    expect(claimDaily({ ...full, cards: 1 }, now).cards).toBe(1);
  });
  it('awards each fifth completed game with a capacity of two', () => {
    let wallet = emptyCards();
    for (let game = 1; game <= 15; game++) {
      wallet = completeGame(wallet);
      expect(wallet.completedGames).toBe(game);
      expect(wallet.cards).toBe(Math.min(2, Math.floor(game / 5)));
    }
    wallet.cards--;
    expect(completeGame(wallet).cards).toBe(1);
  });
});
