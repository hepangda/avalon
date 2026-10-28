import type { ClientGameState } from '@/lib/engine';

/** Prefix a player's name with their 1-based seat number, e.g. "3. Alice".
 *  Used everywhere a name is shown so strangers can refer to "player 3". */
export function seatLabel(seat: number, name: string): string {
  return `${seat + 1}. ${name}`;
}

/** Players in seat order: every list of seats shown to players counts up from 1. */
export function bySeat(game: { players: ReadonlyArray<{ id: string; seat: number }> }, ids: readonly string[]): string[] {
  const seat = (id: string) => game.players.find((p) => p.id === id)?.seat ?? Number.MAX_SAFE_INTEGER;
  return [...ids].sort((a, b) => seat(a) - seat(b));
}

/** Resolve a player id to its seat-numbered label within a game projection.
 *  Falls back to "???" for unknown ids. */
export function labelById(game: Pick<ClientGameState, 'players'>, id: string): string {
  const p = game.players.find((x) => x.id === id);
  return p ? seatLabel(p.seat, p.name) : '???';
}
