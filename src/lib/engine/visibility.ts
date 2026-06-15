import type { PlayerId, Role, VisibilityInfo } from './types';
import { isEvil } from './roles';

/**
 * Compute what a viewer learns about other players at RoleReveal.
 *
 * Rules (authoritative):
 *  - Merlin sees all evil EXCEPT Mordred (but DOES see Oberon).
 *  - Percival sees Merlin and Morgana as one indistinguishable category.
 *  - Evil players (Morgana/Assassin/Mordred/Minion) see each other EXCEPT
 *    Oberon (mutual: Oberon sees no allies, allies don't see Oberon).
 *  - Oberon and LoyalServant see no one.
 *
 * Pure & server-only. Output order follows seat order of `all` for stability.
 */
export function computeKnownPlayers(
  viewer: { id: PlayerId; role: Role },
  all: ReadonlyArray<{ id: PlayerId; role: Role }>,
): VisibilityInfo[] {
  const others = all.filter((p) => p.id !== viewer.id);

  switch (viewer.role) {
    case 'Merlin':
      return others
        .filter((p) => isEvil(p.role) && p.role !== 'Mordred')
        .map((p) => ({ playerId: p.id, shownAs: 'evil', certain: true }));

    case 'Percival':
      return others
        .filter((p) => p.role === 'Merlin' || p.role === 'Morgana')
        .map((p) => ({ playerId: p.id, shownAs: 'merlin-or-morgana', certain: false }));

    case 'Morgana':
    case 'Assassin':
    case 'Mordred':
    case 'Minion':
      return others
        .filter((p) => isEvil(p.role) && p.role !== 'Oberon')
        .map((p) => ({ playerId: p.id, shownAs: 'known-ally', certain: true }));

    case 'Oberon':
    case 'LoyalServant':
      return [];

    default:
      return [];
  }
}
