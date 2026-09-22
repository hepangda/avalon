import { fallbackSeatName } from '@/lib/game/names';
import { sanitizeName } from '@/lib/game/displayName';
import { rejectionLimit, type GameOptions } from '@/lib/engine';
export { sanitizeName } from '@/lib/game/displayName';
import type { RoomConfig, RoomMember, RoomSnapshot } from '@/lib/socket/types';
import type { RoomMeta } from './schema';

/** Pure room helpers (ported from the old GameStore + createRoom), operating on
 *  a plain members Map + config so the Durable Object stays thin. */

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxPlayers: 10,
  allowSpectators: true,
  allowMidJoin: true,
  options: {
    oberon: false,
    mordred: false,
    morgana: true,
    percival: true,
    ladyOfTheLake: false,
    maxRejections: 5,
  },
  roster: [],
};

type Members = Map<string, RoomMember>;

/** Non-spectator members, ordered by seat. */
export function activePlayers(members: Members): RoomMember[] {
  return [...members.values()].filter((m) => !m.isSpectator).sort((a, b) => a.seat - b.seat);
}

/** Next free seat index for a non-spectator member. */
export function nextSeat(members: Members): number {
  const used = new Set(
    [...members.values()].filter((m) => !m.isSpectator).map((m) => m.seat),
  );
  let seat = 0;
  while (used.has(seat)) seat++;
  return seat;
}

/** Roster seats nobody currently holds (claimable by a joining player). */
export function claimableSeats(members: Members): RoomMember[] {
  return [...members.values()]
    .filter((m) => !m.isSpectator && !m.claimed)
    .sort((a, b) => a.seat - b.seat);
}

export function snapshot(
  meta: RoomMeta,
  members: Members,
  hostPlayerId: string | null,
): RoomSnapshot {
  return {
    code: meta.code,
    hostPlayerId,
    status: meta.status,
    config: meta.config,
    members: [...members.values()].sort((a, b) => {
      if (a.isSpectator !== b.isSpectator) return a.isSpectator ? 1 : -1;
      return a.seat - b.seat;
    }),
  };
}

/** Accept only bounded HTTP(S) profile-image URLs supplied by the saved identity. */
export function sanitizeAvatarUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2_048) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** True if `name` is taken by another member (case-insensitive). */
export function isNameTaken(members: Members, name: string, exceptPlayerId?: string): boolean {
  const lower = name.toLowerCase();
  for (const m of members.values()) {
    if (m.id === exceptPlayerId) continue;
    if (m.name.toLowerCase() === lower) return true;
  }
  return false;
}

function sanitizeOptions(options: GameOptions): GameOptions {
  const pairedRoles = Boolean(options?.morgana || options?.percival);
  return {
    oberon: Boolean(options?.oberon),
    mordred: Boolean(options?.mordred),
    morgana: pairedRoles,
    percival: pairedRoles,
    ladyOfTheLake: Boolean(options?.ladyOfTheLake),
    maxRejections: rejectionLimit(options?.maxRejections),
  };
}

export function sanitizeConfig(
  config: RoomConfig,
  roster: string[],
): RoomConfig {
  return {
    maxPlayers: clampInt(config.maxPlayers, 5, 10),
    // Spectators and mid-join are always allowed (no longer host-configurable).
    allowSpectators: true,
    allowMidJoin: true,
    options: sanitizeOptions(config.options),
    roster,
  };
}

/** Normalize roster names: trim, cap at 10 seats, fill blanks with "Player N". */
export function sanitizeRoster(raw: string[]): string[] {
  return raw.slice(0, 10).map((n, i) => sanitizeName(n) || fallbackSeatName(i));
}

/** Restore the host-defined seat identity after its occupant stands. */
export function restoreSeatIdentity(member: RoomMember, roster: string[]): void {
  member.name = sanitizeName(roster[member.seat] ?? '') || fallbackSeatName(member.seat);
  delete member.avatarUrl;
}

export function mergeConfig(partial: Partial<RoomConfig> | undefined, roster: string[]): RoomConfig {
  const base = partial ?? {};
  return {
    maxPlayers: clampInt(
      base.maxPlayers ?? Math.max(roster.length, DEFAULT_ROOM_CONFIG.maxPlayers),
      5,
      10,
    ),
    allowSpectators: base.allowSpectators ?? DEFAULT_ROOM_CONFIG.allowSpectators,
    allowMidJoin: base.allowMidJoin ?? DEFAULT_ROOM_CONFIG.allowMidJoin,
    options: sanitizeOptions({ ...DEFAULT_ROOM_CONFIG.options, ...(base.options ?? {}) }),
    roster,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
