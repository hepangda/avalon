import { describe, expect, it } from 'vitest';
import { buildStartedGame } from './testkit';
import { reduce } from './reducer';
import { createRng } from './rng';
import { projectStateForViewer } from './projection';

const setup = () => buildStartedGame(['Merlin', 'LoyalServant', 'LoyalServant', 'Assassin', 'Minion']);
describe('reroll cards', () => {
  it('always changes the user role while preserving the exact role multiset and replay determinism', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const player of setup().players) {
        const state = setup();
        state.roleAcks = state.players.filter((p) => p.id !== player.id).map((p) => p.id);
        const event = { type: 'USE_REROLL_CARD' as const, by: player.id, roleRevision: 0 };
        const result = reduce(state, event, { now: 100, rng: createRng(String(seed)) });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        expect(result.state.players.find((p) => p.id === player.id)!.role).not.toBe(player.role);
        expect(result.state.players.map((p) => p.role).sort()).toEqual([...state.config.roles].sort());
        expect(result.state.assassinId).toBe(result.state.players.find((p) => p.role === 'Assassin')!.id);
        expect(result.state.roleAcks).toEqual([]);
        expect(result.state.roleRevision).toBe(1);
        expect(result.state.actionTimers).toHaveLength(5);
        expect(reduce(state, event, { now: 100, rng: createRng(String(seed)) })).toEqual(result);
        expect(projectStateForViewer(result.state, 'spectator').players.every((p) => !p.role)).toBe(true);
        expect(state.players.find((p) => p.id === player.id)!.role).toBe(player.role);
      }
    }
  });

  it('rejects stale revisions, confirmed roles, spectators, and a closed opening', () => {
    const base = setup();
    for (const state of [{ ...base, roleRevision: 1 }, { ...base, roleAcks: ['p0'] }, { ...base, openingClosed: true }]) {
      expect(reduce(state, { type: 'USE_REROLL_CARD', by: 'p0', roleRevision: 0 }, { now: 1, rng: createRng('a') }).ok).toBe(false);
    }
    expect(reduce(base, { type: 'USE_REROLL_CARD', by: 'outsider', roleRevision: 0 }, { now: 1, rng: createRng('a') }).ok).toBe(false);
  });

  it('replaces obsolete private role knowledge and rejects acknowledgements for the old deal', () => {
    let state = setup();
    for (let revision = 0; revision < 2; revision++) {
      const result = reduce(state, { type: 'USE_REROLL_CARD', by: 'p0', roleRevision: revision }, { now: 100 + revision, rng: createRng(String(revision)) });
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expect(state.logs.filter((log) => log.key === 'yourRole')).toHaveLength(5);
    expect(reduce(state, { type: 'ACK_ROLE', by: 'p0', roleRevision: 1 }, { now: 200, rng: createRng('a') }).ok).toBe(false);
  });
});
