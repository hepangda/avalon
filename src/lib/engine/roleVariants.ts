import { createRng } from './rng';
import type { GameState, PlayerId } from './types';

/**
 * Cosmetic assignment from a separate, secret-seeded stream. Shuffling both
 * players and art prevents a variant from revealing a servant's seating rank.
 * Recomputed from saved state, so reconnects, rollbacks and replays agree.
 */
export function roleVariants(state: Pick<GameState, 'seed' | 'players'>): Record<PlayerId, number> {
  const rng = createRng(`${state.seed}:role-art:v1`);
  const servants = rng.shuffle(
    state.players.filter((p) => p.role === 'LoyalServant').sort((a, b) => a.seat - b.seat),
  );
  const variants = rng.shuffle([0, 1, 2, 3]);
  return Object.fromEntries(servants.map((player, index) => [player.id, variants[index % 4]!]));
}
