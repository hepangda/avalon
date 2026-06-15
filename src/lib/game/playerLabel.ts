import type { ClientGameState } from '@/lib/engine';

/** Prefix a player's name with their 1-based seat number, e.g. "3. Alice".
 *  Used everywhere a name is shown so strangers can refer to "player 3". */
export function seatLabel(seat: number, name: string): string {
  return `${seat + 1}. ${name}`;
}

/** Resolve a player id to its seat-numbered label within a game projection.
 *  Falls back to "???" for unknown ids. */
export function labelById(game: Pick<ClientGameState, 'players'>, id: string): string {
  const p = game.players.find((x) => x.id === id);
  return p ? seatLabel(p.seat, p.name) : '???';
}
