import type { ClientGameState } from '@/lib/engine';
import type { RoomSnapshot } from './types';

/** Canonical JSON shared by PostgreSQL recovery and browser view verification. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface RoomView {
  room: RoomSnapshot;
  game: ClientGameState | null;
  playerId: string | null;
  isHost: boolean;
  isReferee: boolean;
}

export interface ViewStamp {
  /** Changes on process restart; old connection messages cannot cross epochs. */
  epoch: string;
  revision: number;
  hash: string;
}
export interface ViewSnapshot extends ViewStamp {
  view: RoomView;
  /** Explicit recovery clears presentations even when the game phase is unchanged. */
  recovery?: boolean;
}
export interface HeartbeatState {
  sync: ViewStamp | null;
}

/** Hash only authoritative per-viewer data, never private server state or local clocks. */
export function viewContent(view: RoomView): RoomView {
  return {
    ...view,
    room: { ...view.room, members: view.room.members.map(({ latency: _latency, ...member }) => member) },
    game: view.game ? {
      ...view.game,
      serverTime: undefined,
      players: view.game.players.map(({ latency: _latency, ...player }) => player),
    } : null,
  };
}
