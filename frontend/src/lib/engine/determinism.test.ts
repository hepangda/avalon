import { describe, it, expect } from 'vitest';
import type { GameOptions } from './types';
import { createGame, reduce } from './reducer';
import { createRng } from './rng';

// 7 players → good 4 / evil 3. Evil specials must fit in 3: Morgana + Mordred +
// Assassin. (Oberon would make 4 evil specials, exceeding the evil count.)
const OPTS: GameOptions = {
  oberon: false,
  mordred: true,
  morgana: true,
  percival: true,
  ladyOfTheLake: true,
};

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
}

function assign(seed: string, n = 7) {
  const created = createGame({ hostId: 'p0', players: makePlayers(n), options: OPTS, seed });
  if (!created.ok) throw new Error('create failed');
  const started = reduce(created.state, { type: 'START_GAME', by: 'p0' }, { now: 0, rng: createRng('x') });
  if (!started.ok) throw new Error('start failed');
  return started.state;
}

describe('Determinism / replay', () => {
  it('same seed → identical role assignment and initial leader', () => {
    const a = assign('seed-123');
    const b = assign('seed-123');
    expect(a.players.map((p) => p.role)).toEqual(b.players.map((p) => p.role));
    expect(a.leaderIndex).toBe(b.leaderIndex);
    expect(a.assassinId).toBe(b.assassinId);
    expect(a.ladyHolderId).toBe(b.ladyHolderId);
  });

  it('different seeds generally differ', () => {
    const a = assign('seed-A');
    const b = assign('seed-B');
    // Not a guarantee but overwhelmingly likely for 7 players.
    const same = a.players.map((p) => p.role).join() === b.players.map((p) => p.role).join();
    expect(same).toBe(false);
  });

  it('role multiset is preserved (only order shuffled)', () => {
    const a = assign('seed-xyz');
    const sortedAssigned = a.players.map((p) => p.role).sort();
    const sortedConfig = [...a.config.roles].sort();
    expect(sortedAssigned).toEqual(sortedConfig);
  });

  it('createGame refuses invalid player counts', () => {
    const r = createGame({ hostId: 'p0', players: makePlayers(4), options: OPTS, seed: 's' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PLAYER_COUNT');
  });

  it('seeded RNG shuffle is reproducible', () => {
    const r1 = createRng('abc').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const r2 = createRng('abc').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r1).toEqual(r2);
  });
});
