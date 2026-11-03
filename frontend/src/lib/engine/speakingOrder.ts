import type { GameState, PlayerId } from './types';

/**
 * Who speaks, in turn, when the leader opens the discussion in a direction.
 * The client uses it to name the first speaker on the leader's two buttons;
 * it mirrors the Rust engine, which a test checks.
 */
export function speakingOrder(
  players: ReadonlyArray<{ id: PlayerId; seat: number }>,
  leader: PlayerId,
  direction: 'clockwise' | 'counterclockwise',
  // Required: games stored before versions existed have none, and must keep their order.
  flowVersion: GameState['flowVersion'],
): PlayerId[] {
  const seats = [...players].sort((a, b) => a.seat - b.seat);
  // Start with the next seat so the leader closes the discussion. Older logs
  // retain their original order when restored or replayed.
  const offset = flowVersion === 2 || flowVersion === 3 ? 0 : 1;
  // Seats increase left-to-right along the bottom row: decreasing seats
  // move clockwise, starting at the leader's left hand.
  const step = flowVersion === 5 && direction === 'clockwise' ? -1 : 1;
  const start = seats.findIndex((p) => p.id === leader) + offset * step;
  return seats.map((_, i) => seats[((start + i * step) % seats.length + seats.length) % seats.length]!.id);
}
