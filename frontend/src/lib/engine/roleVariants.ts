import { createRng } from './rng';
import type { GameState, PlayerId } from './types';

/**
 * Cosmetic assignment from a separate, secret-seeded stream. Shuffling both
 * players and art prevents a variant from revealing a role's seating rank.
 * Recomputed from saved state, so reconnects, rollbacks and replays agree.
 */
export function roleVariants(state: Pick<GameState, 'seed' | 'players'>): Record<PlayerId, number> {
  const assigned: Record<PlayerId, number> = {};
  for (const [role, count] of [['LoyalServant', 5], ['Minion', 2]] as const) {
    const rng = createRng(`${state.seed}:role-art:v2:${role}`);
    const players = rng.shuffle(
      state.players.filter((p) => p.role === role).sort((a, b) => a.seat - b.seat),
    );
    const variants = rng.shuffle(Array.from({ length: count }, (_, index) => index));
    for (const [index, player] of players.entries()) {
      assigned[player.id] = variants[index % count]!;
    }
  }
  return assigned;
}
