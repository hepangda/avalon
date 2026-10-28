import { describe, expect, it } from 'vitest';
import { inferHistoricalNames, recoverNamedSeats } from './history-name-recovery';
import { exclusion, fitRatings } from './ratings';
import { record } from './test-records';
function fixture() {
  const game = record();
  game.participants = Object.values(game.seats);
  game.seats = {};
  game.replay.players.forEach((p, i) => { p.name = `Name ${i}`; });
  return game;
}
describe('explicit historical name recovery', () => {
  it('uses attendance and verified names to resolve only unique mappings', () => {
    const g = fixture();
    const names = inferHistoricalNames([g], Array.from({ length: 4 }, (_, i) => ({ name: `Name ${i}`, account: `account${i}` })));
    expect(names.size).toBe(5);
    expect(recoverNamedSeats(g, names)).toEqual(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}`, `account${i}`])));
    expect(g.seats).toEqual({});
  });
  it('leaves ambiguous names and unconfirmed attendance unlinked', () => {
    const g = fixture();
    const names = inferHistoricalNames([g], [{ name: 'Name 0', account: 'account0' }]);
    expect(names.size).toBe(1);
    expect(recoverNamedSeats(g, names)).toEqual({ p0: 'account0' });
    g.participants = [];
    expect(recoverNamedSeats(g, names)).toEqual({});
  });
  it('rejects evidence conflicts and never substitutes an existing seat', () => {
    const g = fixture();
    expect(() => inferHistoricalNames([g], [{ name: 'Name 0', account: 'outsider' }])).toThrow();
    g.seats = { p0: 'original' };
    expect(recoverNamedSeats(g, new Map([['name 0', 'account0']]))).toEqual({ p0: 'original' });
  });
  it('requires explicit legacy approval, retains known exclusions, and separates unknown configurations', () => {
    const g = fixture(); g.seats = record().seats; g.altered = null; delete g.replay.options;
    expect(exclusion(g)).toBe('legacy');
    g.ratingImport = 'name-recovery-v1';
    expect(exclusion(g)).toBeNull();
    expect(fitRatings([g]).players.size).toBe(5);
    g.altered = true; expect(exclusion(g)).toBeNull();
    g.altered = null; g.replay.players[1]!.isBot = true; expect(exclusion(g)).toBe('bots');
  });
});
