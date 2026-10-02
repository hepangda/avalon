import { Hono, type Context } from 'hono';
import type { RoomConfig } from '@/lib/socket/types';
import type { Env } from './env';
import { makeCode } from './ids';
import { accountKey, accountProfile } from './account-profile';
import { accountDisplayName } from '@/lib/auth/types';
import { parsePreferencePatch } from '@/lib/preferences';
import { sanitizeName } from '@/lib/game/displayName';
import {
  AuthError,
  OidcCallbackFailure,
  authCallbackUiError,
  authErrorRedirectPath,
  beginOidcLogin,
  clearAuthSession,
  completeOidcLogin,
  getCurrentAuthUser,
  isSilentOidcCallback,
  safeReturnPath,
} from './auth';

/** Shared HTTP API; Node injects runtime services and OIDC configuration. */
const app = new Hono<{ Bindings: Env }>();

function roomObject(env: Env, code: string) {
  return env.rooms.get(code);
}

app.get('/api/health', (c) => c.json({ ok: true, status: 'healthy' }));

// Local, authenticated convenience route. Never available on a deployed hostname.
app.get('/debug/addRandomCard', async (c) => {
  c.header('Cache-Control', 'no-store');
  const hostname = new URL(c.req.url).hostname;
  if (c.env.ENVIRONMENT !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return c.notFound();
  }
  if (c.req.header('Sec-Fetch-Site') === 'cross-site' ||
    (c.req.header('Origin') && c.req.header('Origin') !== new URL(c.req.url).origin)) {
    return c.json({ code: 'INVALID_ORIGIN' }, 403);
  }
  try {
    const user = await getCurrentAuthUser(c);
    if (!user) return c.json({ code: 'AUTH_REQUIRED' }, 401);
    const rerollCards = await c.env.persistence.grantDebugCard(accountKey(c.env.OIDC_ISSUER!, user.id));
    return c.json({ rerollCards });
  } catch (error) {
    return authErrorResponse(c, error);
  }
});



app.get('/api/auth/session', async (c) => {
  c.header('Cache-Control', 'no-store');
  try {
    const user = await getCurrentAuthUser(c);
    const rerollCards = user ? await accountProfile(c.env, user.id).getCards(Date.now()) : undefined;
    const preferences = user ? await accountProfile(c.env, user.id).getPreferences() : undefined;
    return c.json({ user: user ? { ...user, rerollCards, preferences } : null });
  } catch (error) {
    return authErrorResponse(c, error);
  }
});

app.get('/api/auth/login', async (c) => {
  try {
    const existing = await getCurrentAuthUser(c);
    if (existing) return c.redirect(safeReturnPath(c.req.query('next')) ?? '/');
    return c.redirect(
      await beginOidcLogin(c, c.req.query('next'), { silent: false }),
    );
  } catch (error) {
    logAuthNavigationError(error);
    return c.redirect(
      authErrorRedirectPath(
        c.req.query('next'),
        authCallbackUiError(error),
      ),
    );
  }
});

// Best-effort OIDC session discovery for the home screen. This endpoint is loaded in
// a hidden iframe with `prompt=none`, so an unavailable IdP session never
// navigates the visible application away from the room.
app.get('/api/auth/silent', async (c) => {
  c.header('Cache-Control', 'no-store');
  try {
    const existing = await getCurrentAuthUser(c);
    if (existing) return c.redirect('/api/auth/silent/complete');
    return c.redirect(
      await beginOidcLogin(c, '/api/auth/silent/complete', { silent: true }),
    );
  } catch (error) {
    logAuthNavigationError(error);
    return c.redirect('/api/auth/silent/complete');
  }
});

app.get('/api/auth/silent/complete', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.body(null, 204);
});

app.get('/api/auth/callback', async (c) => {
  const query = new URL(c.req.url).searchParams;
  try {
    const next = await completeOidcLogin(c, query);
    return c.redirect(next ?? '/');
  } catch (error) {
    const callbackFailure =
      error instanceof OidcCallbackFailure ? error : null;
    if (callbackFailure?.silent || isSilentOidcCallback(query)) {
      logAuthNavigationError(error);
      return c.redirect('/api/auth/silent/complete');
    }
    logAuthNavigationError(error);
    return c.redirect(
      authErrorRedirectPath(
        callbackFailure?.returnPath,
        callbackFailure?.uiCode ?? authCallbackUiError(error),
      ),
    );
  }
});

app.post('/api/auth/logout', (c) => {
  clearAuthSession(c);
  return c.json({ ok: true });
});

app.patch('/api/auth/preferences', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (c.req.header('Origin') !== new URL(c.req.url).origin) {
    return c.json({ code: 'INVALID_ORIGIN' }, 403);
  }
  if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return c.json({ code: 'INVALID_PREFERENCES' }, 400);
  }
  try {
    const user = await getCurrentAuthUser(c);
    if (!user) return c.json({ code: 'AUTH_REQUIRED' }, 401);
    const patch = parsePreferencePatch(await c.req.json().catch(() => null));
    if (!patch) return c.json({ code: 'INVALID_PREFERENCES' }, 400);
    return c.json({ preferences: await accountProfile(c.env, user.id).savePreferences(patch) });
  } catch (error) {
    return authErrorResponse(c, error);
  }
});

app.post('/api/auth/alias', async (c) => {
  c.header('Cache-Control', 'no-store');
  // A cookie authenticates the account; require a same-origin JSON request for writes.
  if (c.req.header('Origin') !== new URL(c.req.url).origin) {
    return c.json({ code: 'INVALID_ORIGIN', error: 'Same-origin request required' }, 403);
  }
  if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return c.json({ code: 'INVALID_ALIAS', error: 'JSON body required' }, 400);
  }
  try {
    const user = await getCurrentAuthUser(c);
    if (!user) return c.json({ code: 'AUTH_REQUIRED', error: 'Sign in to save an alias' }, 401);
    const body = await c.req.json<{ alias?: unknown }>().catch(() => null);
    const alias = typeof body?.alias === 'string' ? sanitizeName(body.alias) : '';
    if (!alias) return c.json({ code: 'INVALID_ALIAS', error: 'Alias cannot be empty' }, 400);
    const saved = await accountProfile(c.env, user.id).setAlias(alias);
    return c.json({ user: { ...user, alias: saved, rerollCards: await accountProfile(c.env, user.id).getCards() } });
  } catch (error) {
    return authErrorResponse(c, error);
  }
});

// Create a room: generate a code, initialize a fresh persistent room, retry on
// code collisions.
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

// Room previews and replays follow the same account requirement as live rooms.
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

// Full replay for a finished game, independent of the current room.
app.get('/api/games/:id/replay', async (c) => {
  // Referee corrections may replace the record, so never cache an old version or 404.
  c.header('Cache-Control', 'no-store');
  const id = c.req.param('id');
  const replay = await c.env.persistence.loadReplay(id);
  if (!replay) return c.json({ error: 'Game not found' }, 404);
  return c.json(replay);
});

// Node handles valid WebSocket upgrades before reaching the HTTP router.
app.get('/rooms/:code/ws', (c) => c.json({ error: 'Expected websocket' }, 426));

export default app;

async function requireAccount(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  c.header('Cache-Control', 'no-store');
  try {
    if (!await getCurrentAuthUser(c)) {
      return c.json({ code: 'AUTH_REQUIRED', error: 'Sign in to continue' }, 401);
    }
  } catch (error) {
    return authErrorResponse(c, error);
  }
  await next();
}

function authErrorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
  if (error instanceof AuthError) {
    return c.json({ code: error.code, error: error.message }, error.status);
  }
  console.error(
    JSON.stringify({
      message: 'Authentication request failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.json({ code: 'AUTH_FAILED', error: 'Authentication failed' }, 500);
}

function logAuthNavigationError(error: unknown) {
  const original =
    error instanceof OidcCallbackFailure ? error.originalError : error;
  if (original instanceof AuthError && original.status < 500) return;
  console.error(
    JSON.stringify({
      message: 'Authentication navigation failed',
      error: original instanceof Error ? original.message : String(original),
    }),
  );
}
