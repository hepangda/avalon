import { sanitizeName } from '@/lib/game/displayName';
import { parsePreferencePatch } from '@/lib/preferences';
import { Hono } from 'hono';
import { accountKey, accountProfile } from '../account-profile';
import {
  getCurrentAuthUser
} from '../auth';
import type { Env } from '../env';
import { authErrorResponse } from './helpers';

const app = new Hono<{ Bindings: Env }>();
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
export default app;
