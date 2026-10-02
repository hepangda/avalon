import { describe, expect, it } from 'vitest';
import { buildRoleSet } from './roles';
import { recommendedOptions } from './presets';
import { createRng } from './rng';
import { createGame, reduce } from './reducer';
import { DEFAULT_OPTIONS } from './testkit';
import {
  ALL_ROLES, normalizeRoleWeights, settledRoleWeights, validRoleAssignment, weightedRoleAssignment,
} from './roleWeights';

describe('persistent role preferences', () => {
  it('starts at 100, changes by the original 25 points, floors at 50, and has no 100-point ceiling', () => {
    let weights = normalizeRoleWeights(undefined);
    expect(Object.values(weights)).toEqual(ALL_ROLES.map(() => 100));
    for (let game = 1; game <= 20; game++) {
      weights = settledRoleWeights(weights, 'Merlin');
      expect(weights.Merlin).toBe(Math.max(50, 100 - game * 25));
      for (const role of ALL_ROLES.filter((role) => role !== 'Merlin')) expect(weights[role]).toBe(100 + game * 25);
    }
    expect(settledRoleWeights(weights, 'Assassin')).toMatchObject({ Merlin: 75, Assassin: 575, Oberon: 625 });
  });

  it.each([5, 6, 7, 8, 9, 10])('always fills a legal %i-player deck with repeated roles and weighted rerolls', (size) => {
    const deck = buildRoleSet(size, recommendedOptions(size));
    const players = Array.from({ length: size }, (_, i) => ({ id: `p${i}` }));
    for (let seed = 0; seed < 40; seed++) {
      const weights = Object.fromEntries(players.map((player, i) => [player.id,
        Object.fromEntries(ALL_ROLES.map((role, j) => [role, 50 + ((i + j + seed) % 6) * 25])),
      ]));
      const roles = weightedRoleAssignment(players, deck, weights, createRng(`${seed}`), { playerId: 'p0', role: 'Merlin' });
      expect(validRoleAssignment(deck, roles)).toBe(true);
      expect(roles![0]).not.toBe('Merlin');
      expect(roles).toEqual(weightedRoleAssignment(players, deck, weights, createRng(`${seed}`), { playerId: 'p0', role: 'Merlin' }));
    }
  });

  it('increases the chance of a preferred role while respecting the shared role counts', () => {
    const deck = buildRoleSet(5, DEFAULT_OPTIONS);
    const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` }));
    let ordinary = 0;
    let weighted = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const sample = (weights: Record<string, unknown>) => weightedRoleAssignment(players, deck, weights, createRng(`distribution-${seed}`))![0];
      if (sample({}) === 'Merlin') ordinary++;
      if (sample({ p0: { Merlin: 400 } }) === 'Merlin') weighted++;
    }
    expect(ordinary).toBeGreaterThan(150);
    expect(ordinary).toBeLessThan(250);
    expect(weighted).toBeGreaterThan(420);
    expect(weighted).toBeLessThan(580);
  });

  it.each([null, { Merlin: NaN, Assassin: -1 }, { Merlin: Infinity, Percival: 'broken' }, { Merlin: Number.MAX_VALUE }])(
    'handles missing, corrupt and extreme values without a dead-end assignment: %j', (raw) => {
      const deck = buildRoleSet(10, recommendedOptions(10));
      const players = deck.map((_, i) => ({ id: `p${i}` }));
      const weights = Object.fromEntries(players.map((player) => [player.id, raw]));
      for (const next of [() => 0, () => 0.999999, () => NaN]) {
        expect(validRoleAssignment(deck, weightedRoleAssignment(players, deck, weights, { next }))).toBe(true);
      }
    },
  );

  it('uses a valid server assignment but falls back to ordinary dealing for malformed overrides', () => {
    const created = createGame({ hostId: 'p0', players: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), options: DEFAULT_OPTIONS, seed: 'override' });
    if (!created.ok) throw new Error(created.error.message);
    const assignedRoles = [...created.state.config.roles].reverse();
    const ctx = { now: 1, rng: createRng('event') };
    const result = reduce(created.state, { type: 'START_GAME', by: 'p0', assignedRoles }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.players.map((player) => player.role)).toEqual(assignedRoles);
    for (const invalid of [[], ['Merlin'], Array(5).fill('Merlin')]) {
      const fallback = reduce(created.state, { type: 'START_GAME', by: 'p0', assignedRoles: invalid as typeof assignedRoles }, ctx);
      expect(fallback.ok).toBe(true);
      if (fallback.ok) expect(validRoleAssignment(created.state.config.roles, fallback.state.players.map((player) => player.role))).toBe(true);
    }
  });
});
