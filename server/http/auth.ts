import { Hono } from 'hono';
import { accountProfile } from '../account-profile';
import {
  OidcCallbackFailure,
  authCallbackUiError,
  authErrorRedirectPath,
  beginOidcLogin,
  clearAuthSession,
  completeOidcLogin,
  getCurrentAuthUser,
  isSilentOidcCallback,
  safeReturnPath
} from '../auth';
import type { Env } from '../env';
import { authErrorResponse, logAuthNavigationError } from './helpers';

const app = new Hono<{ Bindings: Env }>();
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
export default app;
