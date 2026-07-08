import type { RoomConfig, RoomMember, RoomStatus } from '@/lib/socket/types';

/**
 * SQLite schema for a single room's Durable Object. Because a DO holds exactly
 * one room, every `roomId` foreign key from the old Postgres schema collapses:
 * `room_meta` is a single row, `player` needs no room key, and the append-only
 * `game_event` log is the sole source of truth for replay/rebuild (the old
 * denormalized Round/Vote/MissionCard/Lady/Assassination tables are gone — that
 * data is reconstructed by replaying the log through the engine).
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS room_meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  code          TEXT    NOT NULL,
  host_token    TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  config        TEXT    NOT NULL,
  game_id       TEXT,
  seed          TEXT,
  event_seq     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS player (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  seat         INTEGER NOT NULL,
  is_spectator INTEGER NOT NULL DEFAULT 0,
  claimed      INTEGER NOT NULL DEFAULT 0,
  connected    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS game_event (
  seq        INTEGER PRIMARY KEY,
  type       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export interface RoomMetaRow {
  [key: string]: SqlStorageValue;
  code: string;
  host_token: string;
  status: string;
  config: string;
  game_id: string | null;
  seed: string | null;
  event_seq: number;
}

export interface PlayerRow {
  [key: string]: SqlStorageValue;
  id: string;
  name: string;
  seat: number;
  is_spectator: number;
  claimed: number;
  connected: number;
}

export interface GameEventRow {
  [key: string]: SqlStorageValue;
  seq: number;
  type: string;
  payload: string;
  created_at: number;
}

/** In-memory room metadata, parsed from `room_meta`. */
export interface RoomMeta {
  code: string;
  hostToken: string;
  status: RoomStatus;
  config: RoomConfig;
  gameId: string | null;
  seed: string | null;
}

export function parseMeta(row: RoomMetaRow): RoomMeta {
  return {
    code: row.code,
    hostToken: row.host_token,
    status: row.status as RoomStatus,
    config: JSON.parse(row.config) as RoomConfig,
    gameId: row.game_id,
    seed: row.seed,
  };
}

export function parseMember(row: PlayerRow): RoomMember {
  return {
    id: row.id,
    name: row.name,
    seat: row.seat,
    isSpectator: row.is_spectator === 1,
    claimed: row.claimed === 1,
    connected: row.connected === 1,
  };
}
