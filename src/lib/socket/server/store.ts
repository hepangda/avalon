import { customAlphabet } from 'nanoid';
import type { PlayerId } from '@/lib/engine';
import type { RoomConfig, RoomMember, RoomRuntime, RoomSnapshot } from '../types';

// Room codes: 6 uppercase letters/digits, unambiguous (no 0/O/1/I).
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = customAlphabet(ROOM_ALPHABET, 6);
const makePlayerId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

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

/**
 * Authoritative in-memory store of all active rooms. Single-process; one
 * instance shared across the Socket.IO server.
 */
export class GameStore {
  private rooms = new Map<string, RoomRuntime>();

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  get(code: string): RoomRuntime | undefined {
    return this.rooms.get(code);
  }

  /** Generate a room code not currently in use. */
  newCode(): string {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    return code;
  }

  newPlayerId(): PlayerId {
    return makePlayerId();
  }

  insert(room: RoomRuntime): void {
    this.rooms.set(room.code, room);
  }

  remove(code: string): void {
    this.rooms.delete(code);
  }

  /** Next free seat index for a non-spectator member. */
  nextSeat(room: RoomRuntime): number {
    const used = new Set(
      [...room.members.values()].filter((m) => !m.isSpectator).map((m) => m.seat),
    );
    let seat = 0;
    while (used.has(seat)) seat++;
    return seat;
  }

  activePlayers(room: RoomRuntime): RoomMember[] {
    return [...room.members.values()]
      .filter((m) => !m.isSpectator)
      .sort((a, b) => a.seat - b.seat);
  }

  /** Roster seats nobody currently holds (claimable by a joining player). */
  claimableSeats(room: RoomRuntime): RoomMember[] {
    return [...room.members.values()]
      .filter((m) => !m.isSpectator && !m.claimed)
      .sort((a, b) => a.seat - b.seat);
  }

  snapshot(room: RoomRuntime): RoomSnapshot {
    return {
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      status: room.status,
      config: room.config,
      members: [...room.members.values()].sort((a, b) => {
        if (a.isSpectator !== b.isSpectator) return a.isSpectator ? 1 : -1;
        return a.seat - b.seat;
      }),
    };
  }

  /** Normalize a requested name; empty/whitespace yields ''. Max 24 chars. */
  sanitizeName(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().slice(0, 24);
  }

  /** True if `name` is taken by another member (case-insensitive). */
  isNameTaken(room: RoomRuntime, name: string, exceptPlayerId?: string): boolean {
    const lower = name.toLowerCase();
    for (const m of room.members.values()) {
      if (m.id === exceptPlayerId) continue;
      if (m.name.toLowerCase() === lower) return true;
    }
    return false;
  }
}

/** Process-wide singleton (survives Next HMR via globalThis). */
const globalForStore = globalThis as unknown as { avalonStore?: GameStore };
export const gameStore: GameStore = globalForStore.avalonStore ?? new GameStore();
if (process.env.NODE_ENV !== 'production') globalForStore.avalonStore = gameStore;
