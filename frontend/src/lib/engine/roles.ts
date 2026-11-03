import type { Role, Team, GameOptions } from './types';
import { PLAYER_COMPOSITION, isValidPlayerCount } from './config';

/** Stable display order, independent of the shuffled deal. */
export const ROLE_ORDER: readonly Role[] = ['Merlin', 'Percival', 'LoyalServant', 'Morgana', 'Mordred', 'Oberon', 'Assassin', 'Minion'];

export const ROLE_TEAM: Record<Role, Team> = {
  Merlin: 'good',
  Percival: 'good',
  LoyalServant: 'good',
  Morgana: 'evil',
  Assassin: 'evil',
  Oberon: 'evil',
  Mordred: 'evil',
  Minion: 'evil',
};

export function teamOf(role: Role): Team {
  return ROLE_TEAM[role];
}

export function isEvil(role: Role): boolean {
  return ROLE_TEAM[role] === 'evil';
}

/**
 * Build the multiset of roles in play from player count + host options.
 *
 * Good always includes Merlin (+ optional Percival), the rest Loyal Servants.
 * Evil always includes Assassin (+ optional Morgana/Mordred/Oberon), the rest
 * Minions of Mordred. Counts are padded/truncated to match the official
 * good/evil split for the player count.
 */
export function buildRoleSet(playerCount: number, options: GameOptions): Role[] {
  if (!isValidPlayerCount(playerCount)) {
    throw new Error(`Invalid player count: ${playerCount}`);
  }
  const { good, evil } = PLAYER_COMPOSITION[playerCount]!;

  const goodRoles: Role[] = ['Merlin'];
  if (options.percival) goodRoles.push('Percival');
  while (goodRoles.length < good) goodRoles.push('LoyalServant');

  const evilRoles: Role[] = ['Assassin'];
  if (options.morgana) evilRoles.push('Morgana');
  if (options.mordred) evilRoles.push('Mordred');
  if (options.oberon) evilRoles.push('Oberon');
  while (evilRoles.length < evil) evilRoles.push('Minion');

  if (goodRoles.length !== good || evilRoles.length !== evil) {
    throw new Error(
      `Role set mismatch for ${playerCount}p: built ${goodRoles.length} blue / ${evilRoles.length} red, ` +
        `expected ${good}/${evil} (too many special roles enabled?)`,
    );
  }

  return [...goodRoles, ...evilRoles];
}
