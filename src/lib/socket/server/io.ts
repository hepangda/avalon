import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types';
import { registerHandlers, type AvalonSocketInit } from './handlers';
import type { AvalonServer } from './runtime';

const globalForIo = globalThis as unknown as { avalonIo?: AvalonServer };

/** Create (or reuse) the Socket.IO server bound to the given HTTP server. */
export function initSocketServer(httpServer: HttpServer): AvalonServer {
  if (globalForIo.avalonIo) return globalForIo.avalonIo;

  const io: AvalonServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    // Long-lived connections; tolerate brief network blips before disconnect.
    pingInterval: 20000,
    pingTimeout: 25000,
  });

  io.on('connection', (socket) => {
    registerHandlers(io, socket as AvalonSocketInit);
  });

  globalForIo.avalonIo = io;
  return io;
}

export function getIo(): AvalonServer | undefined {
  return globalForIo.avalonIo;
}
