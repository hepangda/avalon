import type { Role, Team, GameOptions } from './types';
import { PLAYER_COMPOSITION, isValidPlayerCount } from './config';

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

export function isGood(role: Role): boolean {
  return ROLE_TEAM[role] === 'good';
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
      `Role set mismatch for ${playerCount}p: built ${goodRoles.length} good / ${evilRoles.length} evil, ` +
        `expected ${good}/${evil} (too many special roles enabled?)`,
    );
  }

  return [...goodRoles, ...evilRoles];
}

/** Validate that an explicit role multiset is legal for a player count. */
export function validateRoleSet(playerCount: number, roles: Role[]): true | string {
  if (!isValidPlayerCount(playerCount)) return `Invalid player count ${playerCount}`;
  if (roles.length !== playerCount) {
    return `Role count ${roles.length} != player count ${playerCount}`;
  }
  const { good, evil } = PLAYER_COMPOSITION[playerCount]!;
  const goodCount = roles.filter(isGood).length;
  const evilCount = roles.length - goodCount;
  if (goodCount !== good || evilCount !== evil) {
    return `Role split ${goodCount}/${evilCount} != required ${good}/${evil}`;
  }
  const count = (r: Role) => roles.filter((x) => x === r).length;
  if (count('Merlin') !== 1) return 'Exactly one Merlin required';
  if (count('Assassin') !== 1) return 'Exactly one Assassin required';
  if (count('Percival') > 1) return 'At most one Percival';
  if (count('Morgana') > 1) return 'At most one Morgana';
  if (count('Mordred') > 1) return 'At most one Mordred';
  if (count('Oberon') > 1) return 'At most one Oberon';
  // Percival without Morgana is allowed but pointless; Morgana without Percival
  // is fine. No hard constraint binds them.
  return true;
}
