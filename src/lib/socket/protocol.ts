/**
 * WebSocket wire protocol shared by the browser client and the room Durable
 * Object. Replaces Socket.IO's event/ack machinery with a tiny JSON envelope.
 *
 * Three message shapes travel over a single native WebSocket per room:
 *  - `req`  client → server: an action expecting an ack, correlated by `id`.
 *  - `ack`  server → client: the result for a given request `id`.
 *  - `push` server → client: an unsolicited event (state sync, snapshot, …).
 *
 * `event` strings are the same keys as the old Socket.IO contracts
 * (`ClientToServerEvents` / `ServerToClientEvents`), so the handler logic ports
 * across almost verbatim.
 */
import type { Ack, ClientToServerEvents, ServerToClientEvents } from './types';

export type ClientEvent = keyof ClientToServerEvents;
export type ServerEvent = keyof ServerToClientEvents;

/** Client → server action request, correlated to its ack by `id`. */
export interface WireRequest {
  t: 'req';
  id: string;
  event: ClientEvent;
  payload: unknown;
}

/** Server → client ack for the request with the matching `id`. */
export interface WireAck {
  t: 'ack';
  id: string;
  res: Ack<unknown>;
}

/** Server → client unsolicited push (broadcast or targeted). */
export interface WirePush {
  t: 'push';
  event: ServerEvent;
  payload: unknown;
}

export type ClientMessage = WireRequest;
export type ServerMessage = WireAck | WirePush;
