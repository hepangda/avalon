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

describe('loyal servant art assignment', () => {
  it('deals four distinct appearances and keeps them through serialization, reordering and phase changes', () => {
    const state = game();
    const assigned = roleVariants(state);
    expect(Object.values(assigned).sort()).toEqual([0, 1, 2, 3]);
    const restored = JSON.parse(JSON.stringify(state));
    restored.players.reverse();
    restored.phase = 'Assassination';
    expect(roleVariants(restored)).toEqual(assigned);
  });

  it('supports a fifth servant when Percival is disabled, reusing only one of the four appearances', () => {
    const state = game();
    state.players[1]!.role = 'LoyalServant';
    const assigned = Object.values(roleVariants(state));
    expect(assigned).toHaveLength(5);
    expect(new Set(assigned).size).toBe(4);
  });

  it('never exposes a hidden role through its art variant, including to spectators or during assassination', () => {
    const state = game();
    const assigned = roleVariants(state);
    for (const phase of ['TeamBuilding', 'Assassination'] as const) {
      state.phase = phase;
      for (const viewer of [...state.players.map((p) => p.id), 'spectator']) {
        const view = projectStateForViewer(state, viewer);
        for (const player of view.players) {
          if (player.id === viewer && player.role === 'LoyalServant') {
            expect(player.roleVariant).toBe(assigned[player.id]);
          } else {
            expect(player).not.toHaveProperty('roleVariant');
          }
        }
      }
    }
    state.phase = 'GameOver';
    const view = projectStateForViewer(state, 'spectator');
    for (const player of view.players.filter((p) => p.role === 'LoyalServant')) {
      expect(player.roleVariant).toBe(assigned[player.id]);
    }
  });
});
