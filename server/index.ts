import { AuthError } from "./auth";
import { authenticateRoomSocket } from "./socket-auth";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { createFrontendApp } from "./static-files";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";
import { PostgresPersistence } from "./database";
import { RoomRegistry } from "./rooms";
import { DEFAULT_ATTACHMENT, type Env, type RoomSocket, type SocketAttachment } from "./env";

const port = Number(process.env.PORT ?? 3000);
const publicOrigin = new URL(
  process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`,
).origin;
if (
  process.env.ENVIRONMENT === "production" &&
  !publicOrigin.startsWith("https://")
) {
  throw new Error("Production PUBLIC_ORIGIN must use HTTPS");
}
const database = new PostgresPersistence(
  process.env.DATABASE_URL ?? "",
  Number(process.env.PG_POOL_MAX ?? 10),
);
let shuttingDown = false;
await database.start(() => {
  console.error(
    "[postgres] Room ownership connection lost; restarting is required",
  );
  process.exit(1);
});
const rooms = new RoomRegistry(database);
const env: Env = { ...process.env, rooms, persistence: database };
const serverApp = new Hono();
serverApp.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
serverApp.get("/api/health", async (c) => {
  try {
    await database.health();
    return c.json({ ok: true, status: "healthy" });
  } catch {
    return c.json({ ok: false, status: "unavailable" }, 503);
  }
});
function forwardApi(request: Request) {
  // Use a configured origin, never arbitrary forwarded headers, for OIDC callbacks/cookies.
  const incoming = new URL(request.url);
  return app.fetch(
    new Request(
      `${publicOrigin}${incoming.pathname}${incoming.search}`,
      request,
    ),
    env,
  );
}
serverApp.all("/api/*", (c) => forwardApi(c.req.raw));
serverApp.get("/debug/addRandomCard", (c) => forwardApi(c.req.raw));
serverApp.get("/rooms/:code/ws", (c) =>
  c.json({ error: "Expected websocket" }, 426),
);
serverApp.route('/', createFrontendApp());

const server = serve({
  fetch: serverApp.fetch,
  port,
  hostname: process.env.HOST ?? "0.0.0.0",
});
const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: false,
});
server.on("upgrade", async (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", publicOrigin).pathname;
  const match = /^\/rooms\/([0-9]{4})\/ws$/.exec(pathname);
  if (shuttingDown || !match || request.headers.origin !== publicOrigin) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  let account: string;
  try {
    account = await authenticateRoomSocket(request.headers.cookie ?? '', env);
  } catch (error) {
    const status = error instanceof AuthError && error.status === 401
      ? "401 Unauthorized"
      : "503 Service Unavailable";
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    return;
  }
  if (socket.destroyed || shuttingDown) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    const room = rooms.get(match[1]!);
    let attachment: SocketAttachment = { ...DEFAULT_ATTACHMENT, account };
    const peer: RoomSocket = {
      send: (message) => {
        if (ws.bufferedAmount > 1024 * 1024) {
          ws.close(1013, "Slow client");
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      },
      close: (code, reason) => ws.close(code, reason),
      serializeAttachment: (value) => {
        attachment = value;
      },
      deserializeAttachment: () => attachment,
    };
    room.addSocket(peer);
    let pending = 0;
    ws.on("message", (data, binary) => {
      if (shuttingDown || binary) return;
      if (pending >= 32) {
        ws.close(1013, "Too many pending requests");
        return;
      }
      pending++;
      void room.webSocketMessage(peer, data.toString()).finally(() => {
        pending--;
      });
    });
    ws.on("close", () => {
      if (!shuttingDown)
        void room
          .webSocketClose(peer)
          .catch((error) => console.error("[room] disconnect", error));
    });
    ws.on("error", (error) => room.webSocketError(peer, error));
    let alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30_000);
    heartbeat.unref();
    ws.on("close", () => clearInterval(heartbeat));
  });
});

const eviction = setInterval(() => rooms.evictIdle(), 60_000);
eviction.unref();
console.log(`Avalon listening on port ${port}; public origin ${publicOrigin}`);

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 15_000);
  timeout.unref();
  clearInterval(eviction);
  server.close();
  // Preserve seat ownership during a deploy. Clients rejoin with their existing tokens.
  for (const ws of sockets.clients) ws.close(1012, "Server restarting");
  await rooms.drain();
  await database.close();
  for (const ws of sockets.clients) ws.terminate();
  clearTimeout(timeout);
  process.exit(exitCode);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
