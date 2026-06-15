'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';

export type AvalonClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AvalonClientSocket | null = null;

/**
 * Lazily create (or reuse) the single browser socket. Same-origin; the custom
 * server hosts Socket.IO at /socket.io on the same port as Next.
 */
export function getSocket(): AvalonClientSocket {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    autoConnect: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
  return socket;
}

/** Promisified emit-with-ack. Rejects on transport timeout. */
export function emitWithAck<
  E extends keyof ClientToServerEvents,
  P,
  R,
>(event: E, payload: P): Promise<R> {
  const s = getSocket();
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket request timed out')), 10000);
    // socket.io ack: the server calls the last-arg callback with the result.
    (s.emit as unknown as (e: E, p: P, cb: (r: R) => void) => void)(event, payload, (r: R) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}
