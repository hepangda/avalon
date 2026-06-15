import { prisma } from '@/lib/db/client';
import { fallbackSeatName } from '@/lib/game/names';
import type { RoomConfig, RoomMember, RoomRuntime } from '../types';
import { DEFAULT_ROOM_CONFIG, gameStore } from './store';

export interface CreateRoomInput {
  /** Host-defined seat names. Each becomes an unclaimed roster seat. */
  roster?: string[];
  config?: Partial<RoomConfig>;
}

export interface CreateRoomResult {
  code: string;
  /** Opaque host token — whoever holds it is the room owner. */
  hostToken: string;
}

/**
 * Create a new room with a host-defined roster of NAMED but UNCLAIMED seats.
 * The host is the room owner (identified by an opaque hostToken stored in their
 * browser) and does NOT automatically occupy a seat — they may claim one later
 * like anyone else. Joiners claim seats via `room:claimSeat`.
 */
export async function createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
  const code = gameStore.newCode();
  const hostToken = gameStore.newPlayerId(); // opaque owner token (not a seat)
  const roster = sanitizeRoster(input.roster ?? []);
  const config: RoomConfig = mergeConfig(input.config, roster);

  // Build the roster seats as unclaimed, disconnected Player rows.
  const seats: RoomMember[] = roster.map((name, i) => ({
    id: gameStore.newPlayerId(),
    name,
    seat: i,
    isSpectator: false,
    connected: false,
    claimed: false,
  }));

  const dbRoom = await prisma.room.create({
    data: {
      code,
      hostPlayerId: hostToken,
      status: 'lobby',
      config: config as unknown as object,
      players: {
        create: seats.map((s) => ({
          id: s.id,
          name: s.name,
          seat: s.seat,
          isSpectator: false,
          connected: false,
          claimed: false,
        })),
      },
    },
  });

  const runtime: RoomRuntime = {
    code,
    roomId: dbRoom.id,
    hostPlayerId: hostToken,
    status: 'lobby',
    config,
    members: new Map(seats.map((s) => [s.id, s])),
    socketByPlayer: new Map(),
    spectatorSockets: new Set(),
    game: null,
    gameId: null,
    eventSeq: 0,
    persistChain: Promise.resolve(),
  };
  gameStore.insert(runtime);

  return { code, hostToken };
}

/** Normalize roster names: trim, cap at 10 seats, fill blanks with "Player N". */
function sanitizeRoster(raw: string[]): string[] {
  return raw
    .slice(0, 10)
    .map((n, i) => gameStore.sanitizeName(n) || fallbackSeatName(i));
}

function mergeConfig(partial: Partial<RoomConfig> | undefined, roster: string[]): RoomConfig {
  const base = partial ?? {};
  return {
    maxPlayers: clampInt(base.maxPlayers ?? Math.max(roster.length, DEFAULT_ROOM_CONFIG.maxPlayers), 5, 10),
    allowSpectators: base.allowSpectators ?? DEFAULT_ROOM_CONFIG.allowSpectators,
    allowMidJoin: base.allowMidJoin ?? DEFAULT_ROOM_CONFIG.allowMidJoin,
    options: { ...DEFAULT_ROOM_CONFIG.options, ...(base.options ?? {}) },
    roster,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
