import { describe, expect, it } from 'vitest';
import { buildStartedGame } from './testkit';
import { roleVariants } from './roleVariants';
import { projectStateForViewer } from './projection';

function game() {
  return buildStartedGame([
    'Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'LoyalServant',
    'LoyalServant', 'Morgana', 'Mordred', 'Oberon', 'Assassin',
  ]);
}

describe('role art assignment', () => {
  it('deals distinct appearances and keeps them through serialization, reordering and phase changes', () => {
    const state = game();
    const assigned = roleVariants(state);
    expect(Object.values(assigned)).toHaveLength(4);
    expect(new Set(Object.values(assigned)).size).toBe(4);
    const restored = JSON.parse(JSON.stringify(state));
    restored.players.reverse();
    restored.phase = 'Assassination';
    expect(roleVariants(restored)).toEqual(assigned);
  });

  it('deals all five servant appearances when Percival is disabled', () => {
    const state = game();
    state.players[1]!.role = 'LoyalServant';
    const assigned = Object.values(roleVariants(state));
    expect(assigned).toHaveLength(5);
    expect(assigned.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('never exposes a hidden role through its art variant, including to spectators or during assassination', () => {
    const state = game();
    state.players[7]!.role = 'Minion';
    state.players[8]!.role = 'Minion';
    const assigned = roleVariants(state);
    for (const phase of ['TeamBuilding', 'Assassination'] as const) {
      state.phase = phase;
      for (const viewer of [...state.players.map((p) => p.id), 'spectator']) {
        const view = projectStateForViewer(state, viewer);
        for (const player of view.players) {
          if (player.role && assigned[player.id] !== undefined) {
            expect(player.roleVariant).toBe(assigned[player.id]);
          } else {
            expect(player).not.toHaveProperty('roleVariant');
          }
        }
      }
    }
    state.phase = 'GameOver';
    const view = projectStateForViewer(state, 'spectator');
    for (const player of view.players.filter((p) => assigned[p.id] !== undefined)) {
      expect(player.roleVariant).toBe(assigned[player.id]);
    }
  });

  it('deals both minion appearances independently of servants', () => {
    const state = buildStartedGame([
      'Merlin', 'LoyalServant', 'LoyalServant', 'LoyalServant',
      'Assassin', 'Minion', 'Minion',
    ]);
    const assigned = roleVariants(state);
    expect([assigned.p5, assigned.p6].sort()).toEqual([0, 1]);
    const restored = JSON.parse(JSON.stringify(state));
    restored.players.reverse();
    restored.players.find((p: { id: string }) => p.id === 'p1').role = 'Percival';
    expect(roleVariants(restored).p5).toBe(assigned.p5);
    expect(roleVariants(restored).p6).toBe(assigned.p6);
  });
});
