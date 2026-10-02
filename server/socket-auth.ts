import { accountKey } from './account-profile';
import { AuthError } from './auth';
import type { AuthUser } from '@/lib/auth/types';
import type { Env } from './env';
import app from './app';

/** Verify the cookie before accepting an upgrade, including OIDC refresh. */
export async function authenticateRoomSocket(origin: string, cookie: string, env: Env) {
  const response = await app.fetch(new Request(`${origin}/api/auth/session`, {
    headers: { cookie },
  }), env);
  if (!response.ok) throw new Error('Session verification failed');
  const { user } = await response.json() as { user: AuthUser | null };
  if (!user) throw new AuthError('AUTH_REQUIRED', 401, 'Sign in to enter a room');
  return {
    account: accountKey(env.OIDC_ISSUER!, user.id),
    // OIDC can rotate a refresh token during verification.
    cookies: response.headers.getSetCookie(),
  };
}
