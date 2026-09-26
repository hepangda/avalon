import type { ClientGameState, Role, Team } from '@/lib/engine';
import { ROLE_TEAM_UI } from './roleMeta';

export type RoleNote = Role | Team | 'merlin-or-morgana' | 'percival-claim';
export type RoleNotes = Partial<Record<string, RoleNote>>;

export interface RoleNotesScope {
  gameId: string;
  roleRevision: number;
  playerId: string;
}
export interface RoleNotesDocument extends RoleNotesScope {
  revision: number;
  notes: RoleNotes;
  enabled: boolean;
}
export interface RoleNotesSyncRequest extends RoleNotesScope {
  update?: { baseRevision: number; notes: RoleNotes; enabled: boolean };
}

export function isRoleNote(value: unknown): value is RoleNote {
  return typeof value === 'string' &&
    (value === 'good' || value === 'evil' || value === 'merlin-or-morgana' ||
      value === 'percival-claim' || Object.hasOwn(ROLE_TEAM_UI, value));
}

export function roleNoteTone(note: RoleNote): Team | 'ambiguous' | 'claim' {
  if (note === 'merlin-or-morgana') return 'ambiguous';
  if (note === 'percival-claim') return 'claim';
  return note === 'good' || note === 'evil' ? note : ROLE_TEAM_UI[note];
}

export function roleNotesKey(
  code: string,
  gameId: string,
  viewerId: string | null,
  roleRevision: number,
) {
  return `avalon-role-notes:${JSON.stringify([code, gameId, viewerId, roleRevision])}`;
}

export function readRoleNotes(
  key: string,
  storage: Pick<Storage, 'getItem'>,
): RoleNotes {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, note]) =>
          isRoleNote(note),
      ),
    );
  } catch {
    return {};
  }
}

type KnowledgeView = Pick<
  ClientGameState,
  'selfRole' | 'knownPlayers' | 'config' | 'players'
>;

/** Only use curated private perception, never public roles revealed at game over. */
export function knownRoleNotes(
  game: KnowledgeView,
  viewerId: string | null,
): RoleNotes {
  const result: RoleNotes = {};
  if (viewerId && game.selfRole) result[viewerId] = game.selfRole;
  for (const known of game.knownPlayers) {
    result[known.playerId] =
      known.shownAs === 'merlin-or-morgana'
        ? 'merlin-or-morgana'
        : known.shownAs === 'known-ally'
          ? (known.role ?? 'evil')
          : 'evil';
  }
  const seesEveryRedRole =
    (game.selfRole === 'Merlin' && !game.config.rolesInPlay.includes('Mordred')) ||
    (game.selfRole !== null && ROLE_TEAM_UI[game.selfRole] === 'evil' &&
      game.selfRole !== 'Oberon' && !game.config.rolesInPlay.includes('Oberon'));
  if (seesEveryRedRole) {
    // With no hidden red role, every remaining seat is certainly blue.
    for (const player of game.players) {
      if (!result[player.id]) result[player.id] = 'good';
    }
  }
  return result;
}

export function roleNoteOptions(
  game: KnowledgeView,
  viewerId: string | null,
  playerId: string,
): RoleNote[] {
  if (playerId === viewerId && game.selfRole) return [];
  const known = game.knownPlayers.find((item) => item.playerId === playerId);
  const roles = [...new Set(game.config.rolesInPlay)];
  if (game.selfRole === 'Merlin') {
    // Merlin sees Oberon but not Mordred; only unseen seats can be Mordred.
    if (known) return roles.filter((role) => ROLE_TEAM_UI[role] === 'evil' && role !== 'Mordred');
    const blueChoices: RoleNote[] = roles.includes('Mordred') ? ['good'] : [];
    return [...blueChoices, ...roles.filter((role) =>
      role !== 'Merlin' && (ROLE_TEAM_UI[role] === 'good' || role === 'Mordred'),
    )];
  }
  if (game.selfRole === 'Oberon') {
    // Oberon has no teammate knowledge, so every other role remains possible.
    return ['good', 'evil', ...roles.filter((role) => role !== 'Oberon')];
  }
  if (game.selfRole && ROLE_TEAM_UI[game.selfRole] === 'evil') {
    if (known) return [];
    return roles.filter((role) =>
      ROLE_TEAM_UI[role] === 'good' || role === 'Oberon',
    );
  }
  if (known?.shownAs === 'merlin-or-morgana') {
    const pair = (['Merlin', 'Morgana'] as const).filter((role) =>
      game.config.rolesInPlay.includes(role),
    );
    return pair;
  }
  if (game.selfRole === 'Percival') {
    // Merlin and Morgana are in the known pair; Percival is the viewer.
    const remaining = roles.filter((role) =>
      ROLE_TEAM_UI[role] === 'evil' && role !== 'Morgana',
    );
    return [
      ...(roles.includes('LoyalServant') ? ['LoyalServant' as const] : []),
      'percival-claim',
      ...(remaining.length > 1 ? ['evil' as const] : []),
      ...remaining,
    ];
  }
  if (known?.shownAs === 'known-ally') return [];
  if (known)
    return ['evil', ...roles.filter((role) => ROLE_TEAM_UI[role] === 'evil')];
  return ['good', 'evil', ...roles];
}

export function displayedRoleNotes(
  game: KnowledgeView,
  viewerId: string | null,
  manual: RoleNotes,
  enabled: boolean,
): RoleNotes {
  if (!enabled) return {};
  const result = knownRoleNotes(game, viewerId);
  for (const player of game.players) {
    const note = manual[player.id];
    if (note && roleNoteOptions(game, viewerId, player.id).includes(note))
      result[player.id] = note;
  }
  return result;
}

export function readRoleNotesEnabled(
  key: string,
  storage: Pick<Storage, 'getItem'>,
): boolean {
  try {
    return storage.getItem(`${key}:show-known`) !== 'false';
  } catch {
    return true;
  }
}

export function changeRoleNote(
  notes: RoleNotes,
  playerId: string,
  note: RoleNote | null,
): RoleNotes {
  const next = { ...notes };
  if (note === null) delete next[playerId];
  else next[playerId] = note;
  return next;
}
