import type { Persistence } from "./persistence";
import type { RoomRegistry } from "./rooms";

export interface Env {
  rooms: RoomRegistry;
  persistence: Persistence;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_RESOURCE?: string;
  OIDC_SESSION_SECRET?: string;
  ENVIRONMENT?: string;
}

export interface SocketAttachment {
  /** Verified OAuth account; never accepted from a WebSocket payload. */
  account?: string;
  playerId?: string;
  isHost: boolean;
  isAdmin: boolean;
}

export interface RoomSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(attachment: SocketAttachment): void;
  deserializeAttachment(): SocketAttachment;
}

export const DEFAULT_ATTACHMENT: SocketAttachment = {
  isHost: false,
  isAdmin: false,
};
