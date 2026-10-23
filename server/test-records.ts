import type { Role } from '@/lib/engine';
import type { GameRecord } from './game-records';

/** A finished, rated five-player game: account<i> holds seat p<i>. */
export function record(id = 'one', winner: 'good' | 'evil' = 'good'): GameRecord {
  const roles: Role[] = ['Merlin', 'Percival', 'LoyalServant', 'Morgana', 'Assassin'];
  return {
    seats: Object.fromEntries(roles.map((_, i) => [`p${i}`, `account${i}`])), altered: false,
    replay: { gameId: id, players: roles.map((_, i) => ({ id: `p${i}`, name: `Player ${i}`, seat: i })),
      roleAssignments: roles.map((role, i) => ({ playerId: `p${i}`, role })),
      outcome: { winner, reason: 'assassin_missed', missionTally: { good: 0, evil: 0 }, revealedRoles: [] }, endedAt: 1000, rounds: [], ladyChecks: [], assassination: null,
      options: { oberon: false, mordred: false, morgana: true, percival: true, ladyOfTheLake: false } },
  };
}
