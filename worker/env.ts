import type { RoomDurableObject } from './room-do';
import type { ReplayDurableObject } from './replay-do';

/** Worker + Durable Object bindings (see wrangler.jsonc). */
export interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
  REPLAY: DurableObjectNamespace<ReplayDurableObject>;
  ASSETS: Fetcher;
  CLOUDFLARE_ACCOUNT_ID?: string;
  REALTIMEKIT_APP_ID?: string;
  REALTIMEKIT_API_TOKEN?: string;
  REALTIMEKIT_PRESET_NAME?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_RESOURCE?: string;
  OIDC_SESSION_SECRET?: string;
  ENVIRONMENT?: string;
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
