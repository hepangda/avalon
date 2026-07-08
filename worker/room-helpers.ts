import { fallbackSeatName } from '@/lib/game/names';
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

export function snapshot(meta: RoomMeta, members: Members): RoomSnapshot {
  return {
    code: meta.code,
    hostPlayerId: meta.hostToken,
    status: meta.status,
    config: meta.config,
    members: [...members.values()].sort((a, b) => {
      if (a.isSpectator !== b.isSpectator) return a.isSpectator ? 1 : -1;
      return a.seat - b.seat;
    }),
  };
}

/** Normalize a requested name; empty/whitespace yields ''. Max 24 chars. */
export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 24);
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

export function sanitizeConfig(config: RoomConfig, roster: string[]): RoomConfig {
  return {
    maxPlayers: clampInt(config.maxPlayers, 5, 10),
    // Spectators and mid-join are always allowed (no longer host-configurable).
    allowSpectators: true,
    allowMidJoin: true,
    options: {
      oberon: Boolean(config.options?.oberon),
      mordred: Boolean(config.options?.mordred),
      morgana: Boolean(config.options?.morgana),
      percival: Boolean(config.options?.percival),
      ladyOfTheLake: Boolean(config.options?.ladyOfTheLake),
    },
    roster,
  };
}

/** Normalize roster names: trim, cap at 10 seats, fill blanks with "Player N". */
export function sanitizeRoster(raw: string[]): string[] {
  return raw.slice(0, 10).map((n, i) => sanitizeName(n) || fallbackSeatName(i));
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
    options: { ...DEFAULT_ROOM_CONFIG.options, ...(base.options ?? {}) },
    roster,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
