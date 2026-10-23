import { Hono, type Context } from 'hono';
import type { ReplayView } from '@/lib/game/replayTypes';
import { accountKey } from '../account-profile';
import { getCurrentAuthUser } from '../auth';
import type { Env } from '../env';
import { historyGames, historyProfile, recordBook, seatRecord, visibleReplay } from '../game-records';
import { authErrorResponse, roomObject } from './helpers';

type HistoryContext = Context<{ Bindings: Env }>;

/** The signed-in account; responses are personal and never cached. */
async function viewer(c: HistoryContext): Promise<string | Response> {
  c.header('Cache-Control', 'no-store');
  try {
    const user = await getCurrentAuthUser(c);
    if (!user) return c.json({ code: 'AUTH_REQUIRED', error: 'Sign in to continue' }, 401);
    return accountKey(c.env.OIDC_ISSUER!, user.id);
  } catch (error) {
    return authErrorResponse(c, error);
  }
}

// Bot games are visible and rated only in development, never by request.
const policy = (c: HistoryContext) => ({ includeBots: c.env.ENVIRONMENT === 'development' });

const app = new Hono<{ Bindings: Env }>();
app.get('/api/history', async (c) => {
  const account = await viewer(c);
  if (account instanceof Response) return account;
  return c.json(historyProfile(await recordBook(c.env.persistence, policy(c)), account));
});

app.get('/api/history/games', async (c) => {
  const account = await viewer(c);
  if (account instanceof Response) return account;
  const offset = Number(c.req.query('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return c.json({ error: 'Invalid query' }, 400);
  return c.json(historyGames(await recordBook(c.env.persistence, policy(c)), account, offset));
});

// Only someone at the same table may open a seat's record; the seat's account stays private.
app.get('/api/rooms/:code/players/:playerId/record', async (c) => {
  const account = await viewer(c);
  if (account instanceof Response) return account;
  const code = c.req.param('code');
  if (!/^[0-9]{4}$/.test(code)) return c.json({ error: 'Invalid room code' }, 400);
  const target = await roomObject(c.env, code).seatAccount(account, c.req.param('playerId'));
  if (!target) return c.json({ error: 'Record not found' }, 404);
  // The owner's privacy choice is enforced here; the viewer always sees their own.
  const hidden = target !== account && (await c.env.persistence.getPreferences(target)).hideRecord === true;
  return c.json(seatRecord(await recordBook(c.env.persistence, policy(c)), target, hidden));
});

app.get('/api/games/:id/replay', async (c) => {
  // Referee corrections may replace the record, so never serve an old version.
  const account = await viewer(c);
  if (account instanceof Response) return account;
  const id = c.req.param('id');
  const replay = await c.env.persistence.loadReplay(id);
  if (!replay || !visibleReplay(replay, policy(c))) return c.json({ error: 'Game not found' }, 404);
  return c.json({ replay, viewerId: await c.env.persistence.findSeat(id, account) } satisfies ReplayView);
});

export default app;
