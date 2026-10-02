import type { DisplayPreferences } from '@/lib/preferences';
import type { RerollCards } from "./reroll-cards";
import type { GameEvent, GameState, Role } from "@/lib/engine";
import type { RoleWeights } from '@/lib/engine/roleWeights';
import type { RoleNotesDocument } from "@/lib/game/roleNotes";
import type { ReplayData } from "@/lib/game/replayTypes";
import type { RoomConfig, RoomMember, RoomStatus } from "@/lib/socket/types";
import type { RoomChange } from "./room-journal";
import type { SeatHistory } from './seating';

export interface RoomMeta {
  code: string;
  hostToken: string;
  hostAccount?: string;
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
  getPreferences(account: string): Promise<Partial<DisplayPreferences>>;
  savePreferences(account: string, patch: Partial<DisplayPreferences>): Promise<Partial<DisplayPreferences>>;
  loadRoom(code: string): Promise<RoomRecord | null>;
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
