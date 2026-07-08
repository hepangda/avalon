import { Hono } from 'hono';
import type { RoomConfig } from '@/lib/socket/types';
import type { Env } from './env';
import { makeCode } from './ids';
import { RoomDurableObject } from './room-do';
import { ReplayDurableObject } from './replay-do';

/**
 * Worker entry. Hono serves the JSON API and forwards WebSocket upgrades to the
 * per-room Durable Object. Static SPA assets + SPA fallback are served by the
 * `ASSETS` binding for every non-worker route (see wrangler.jsonc
 * `run_worker_first`). Replaces the old custom Node server + Next API routes.
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, status: 'healthy' }));

// Create a room: generate a code, initialize a fresh Durable Object, retry on
// the (rare) code collision.
app.post('/api/rooms', async (c) => {
  let body: { roster?: unknown; config?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const roster = Array.isArray(body.roster) ? (body.roster as string[]) : [];
  const config = (body.config ?? undefined) as Partial<RoomConfig> | undefined;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const stub = c.env.ROOM.get(c.env.ROOM.idFromName(code));
    const res = await stub.init({ code, roster, config });
    if (res.ok) return c.json({ code, hostToken: res.hostToken }, 201);
  }
  return c.json({ error: 'Failed to create room' }, 500);
});

// Public, non-sensitive room preview for the join page.
app.get('/api/rooms/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(code));
  const preview = await stub.preview();
  if (!preview) return c.json({ error: 'Room not found' }, 404);
  return c.json(preview);
});

// Full replay for a finished game, keyed by gameId (routes straight to the
// ReplayDurableObject — no Postgres, no index).
app.get('/api/games/:id/replay', async (c) => {
  const id = c.req.param('id');
  const stub = c.env.REPLAY.get(c.env.REPLAY.idFromName(id));
  const replay = await stub.load();
  if (!replay) return c.json({ error: 'Game not found' }, 404);
  return c.json(replay);
});

// WebSocket upgrade → forward the request to the room's Durable Object, which
// completes the handshake with the Hibernation API.
app.get('/rooms/:code/ws', (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ error: 'Expected websocket' }, 426);
  }
  const code = c.req.param('code').toUpperCase();
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(code));
  return stub.fetch(c.req.raw);
});

export default app;
export { RoomDurableObject, ReplayDurableObject };
