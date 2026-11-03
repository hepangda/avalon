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

export type ServerMessage = WireAck | WirePush;

/** Infer each action's payload and acknowledgement from the shared contract. */
export type EventPayload<E extends ClientEvent> = Parameters<ClientToServerEvents[E]>[0];
export type EventAck<E extends ClientEvent> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];
