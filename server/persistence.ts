import type { DisplayPreferences } from '@/lib/preferences';
import type { RerollCards } from "./reroll-cards";
import type { GameEvent, GameState, Role } from "@/lib/engine";
import type { RoleWeights } from '@/lib/engine/roleWeights';
import type { RoleNotesDocument } from "@/lib/game/roleNotes";
import type { ReplayData } from "@/lib/game/replayTypes";
import type { PublicRoomPage, RoomDetails, RoomConfig, RoomMember, RoomStatus } from "@/lib/socket/types";
import type { RoomChange } from "./room-journal";
import type { SeatHistory } from './seating';
import type { GameRecord } from './game-records';

export interface RoomMeta {
  name?: string;
  visibility?: RoomDetails['visibility'];
  code: string;
  hostToken: string;
  hostAccount?: string;
  /** Continuous absence timestamps, retained across runtime recovery. */
  hostOfflineSince?: number;
  allHumansOfflineSince?: number;
  status: RoomStatus;
  config: RoomConfig;
  gameId: string | null;
  seed: string | null;
}

/** Private server snapshot. Never return this document through an HTTP API. */
export interface RoomDocument {
  schemaVersion: 1;
  meta: RoomMeta;
  members: RoomMember[];
  game: GameState | null;
  eventSeq: number;
  events: Array<{ seq: number; event: GameEvent; createdAt: number }>;
  sessions: Record<string, string>;
  notes: Record<string, RoleNotesDocument>;
  accounts?: Record<string, string>;
  gameAccounts?: Record<string, string>;
  lastGameSeats?: SeatHistory;
  archive: {
    replay: ReplayData;
    /** Frozen when the game ends; absent from archives written before seats were linked. */
    seats?: Record<string, string>;
    altered?: boolean;
    revision: number;
    rewardAccounts?: string[];
    roleWeightAssignments?: Record<string, Role>;
  } | null;
}

export interface RoomRecord {
  version: number;
  document: RoomDocument;
}

export interface Persistence {
  /** Every archived game with its private seat links, in one consistent snapshot. */
  listGameRecords(): Promise<GameRecord[]>;
  /** Changes whenever an archive or its seat links change. */
  gameRecordsVersion(): Promise<string>;
  /** The seat an account held in an archived game. */
  findSeat(gameId: string, account: string): Promise<string | null>;
  listRoomCodes(): Promise<string[]>;
  listPublicRooms(page: number): Promise<PublicRoomPage>;
  getPreferences(account: string): Promise<Partial<DisplayPreferences>>;
  savePreferences(account: string, patch: Partial<DisplayPreferences>): Promise<Partial<DisplayPreferences>>;
  loadRoom(code: string): Promise<RoomRecord | null>;
  /** Delete a room only if its committed version still matches. */
  deleteRoom(code: string, version: number): Promise<void>;
  /** Atomic compare-and-swap of room state and completed replay. */
  saveRoom(
    code: string,
    version: number,
    document: RoomDocument,
    spendAccount?: string,
    change?: RoomChange,
  ): Promise<number>;
  /** Verify journal recovery before compacting; independent of the command queue. */
  checkpointRoom?(code: string, version: number, document: RoomDocument): Promise<void>;
  getCards(account: string, claimAt?: number): Promise<RerollCards>;
  grantDebugCard(account: string): Promise<RerollCards>;
  loadReplay(gameId: string): Promise<ReplayData | null>;
  getAlias(account: string): Promise<string | null>;
  setAlias(account: string, alias: string): Promise<string>;
  getRoleWeights(accounts: readonly string[]): Promise<Record<string, RoleWeights>>;
}

export class RoomConflict extends Error {
  constructor() {
    super("Room was changed by another runtime");
  }
}
