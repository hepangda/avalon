import type { RoomDurableObject } from './room-do';
import type { ReplayDurableObject } from './replay-do';

/** Worker + Durable Object bindings (see wrangler.jsonc). */
export interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
  REPLAY: DurableObjectNamespace<ReplayDurableObject>;
  ASSETS: Fetcher;
}

/**
 * Per-connection identity, persisted on the WebSocket via serializeAttachment
 * so it survives Durable Object hibernation. Replaces Socket.IO's `socket.data`.
 */
export interface SocketAttachment {
  /** The claimed seat's player id, once the socket claims/reconnects a seat. */
  playerId?: string;
  /** Authenticated as room owner via the host token. */
  isHost: boolean;
  /** Referee (admin) powers enabled for this socket. */
  isAdmin: boolean;
}

export const DEFAULT_ATTACHMENT: SocketAttachment = { isHost: false, isAdmin: false };
