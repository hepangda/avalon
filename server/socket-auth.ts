import { parse } from 'hono/utils/cookie';
import { accountKey } from './account-profile';
import { AuthError } from './auth';
import { readSession, SESSION_COOKIE } from './auth/session';
import type { Env } from './env';

/** Verify the session cookie before accepting an upgrade and return the account key. */
export async function authenticateRoomSocket(cookie: string, env: Env): Promise<string> {
  const user = await readSession(env, parse(cookie, SESSION_COOKIE)[SESSION_COOKIE]);
  if (!user) throw new AuthError('AUTH_REQUIRED', 401, 'Sign in to enter a room');
  return accountKey(env.OIDC_ISSUER!, user.id);
}
