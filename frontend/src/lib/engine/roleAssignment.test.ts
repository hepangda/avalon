import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { createGame, reduce } from './reducer';
import { DEFAULT_OPTIONS } from './testkit';
import { validRoleAssignment } from './roleAssignment';

describe('server role assignments', () => {
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
