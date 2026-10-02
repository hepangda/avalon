import { accountDisplayName } from '@/lib/auth/types';
import type { RoomConfig } from '@/lib/socket/types';
import { Hono } from 'hono';
import { accountKey } from '../account-profile';
import {
  getCurrentAuthUser
} from '../auth';
import type { Env } from '../env';
import { makeCode } from '../ids';
import { authErrorResponse, requireAccount, roomObject } from './helpers';

const app = new Hono<{ Bindings: Env }>();
app.post('/api/rooms', async (c) => {
  let creator;
  try {
    creator = await getCurrentAuthUser(c);
  } catch (error) {
    return authErrorResponse(c, error);
  }
  if (!creator) {
    return c.json({ code: 'CREATE_ROOM_TOKEN_REQUIRED', error: 'Sign in to create a room' }, 401);
  }

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
    const stub = roomObject(c.env, code);
    const res = await stub.init({
      code,
      roster,
      config,
      creator: {
        name: accountDisplayName(creator), avatarUrl: creator.picture,
        account: accountKey(c.env.OIDC_ISSUER!, creator.id),
      },
    });
    if (res.ok) {
      return c.json(
        {
          code,
          hostToken: res.hostToken,
          playerId: res.playerId,
          playerToken: res.playerToken,
        },
        201,
      );
    }
    if (res.error === 'INVALID_CREATOR') {
      return c.json({ code: 'OIDC_USERINFO_INVALID', error: 'Invalid OAuth username' }, 502);
    }
  }
  return c.json({ error: 'Failed to create room' }, 500);
});

app.use('/api/rooms/:code', requireAccount);

app.use('/api/games/*', requireAccount);

app.get('/api/rooms/:code', async (c) => {
  const code = c.req.param('code');
  if (!/^[0-9]{4}$/.test(code)) return c.json({ error: 'Invalid room code' }, 400);
  const stub = roomObject(c.env, code);
  const preview = await stub.preview();
  if (!preview) return c.json({ error: 'Room not found' }, 404);
  return c.json(preview);
});

app.get('/api/games/:id/replay', async (c) => {
  // Referee corrections may replace the record, so never cache an old version or 404.
  c.header('Cache-Control', 'no-store');
  const id = c.req.param('id');
  const replay = await c.env.persistence.loadReplay(id);
  if (!replay) return c.json({ error: 'Game not found' }, 404);
  return c.json(replay);
});

app.get('/rooms/:code/ws', (c) => c.json({ error: 'Expected websocket' }, 426));
export default app;
