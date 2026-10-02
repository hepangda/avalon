import type { AuthUser } from '@/lib/auth/types';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { accountProfile } from '../account-profile';
import { allowsLoopback, isSecureRequest, oidcIssuer, optionalPictureUrl } from './config';
import { AuthError } from './errors';
import { seal, unseal } from './seal';
import { AppContext, StoredSession } from './types';
import { record, requiredString } from './validation';

export const SESSION_COOKIE = 'avalon_oidc_session';

/**
 * A fixed lifetime from login, never extended by activity. Afterwards the browser
 * signs in again silently, so provider-side revocation applies within this window.
 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// v1 sessions also carried provider tokens; they no longer decrypt and sign in again silently.
export const SESSION_AAD = new TextEncoder().encode('avalon:session:v2');

/** Decrypt a session cookie value locally; no identity-provider request is made. */
export async function readSession(env: Env, value: string | undefined): Promise<AuthUser | null> {
  if (!value) return null;
  const issuer = oidcIssuer(env);
  let session: StoredSession;
  try {
    session = parseSession(await unseal(value, env.OIDC_SESSION_SECRET, SESSION_AAD), allowsLoopback(env));
  } catch (error) {
    if (error instanceof AuthError && error.code === 'OIDC_NOT_CONFIGURED') throw error;
    return null;
  }
  // A session from another issuer would map its subject onto the wrong account.
  return session.issuer === issuer && session.expiresAt > Date.now() ? session.user : null;
}

export async function verifyAuthSession(c: AppContext): Promise<AuthUser | null> {
  const value = getCookie(c, SESSION_COOKIE);
  const user = await readSession(c.env, value);
  if (value && !user) deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return user;
}

/** Account UI reads include its current alias; socket authorization does not query profile data. */
export async function getCurrentAuthUser(c: AppContext): Promise<AuthUser | null> {
  const user = await verifyAuthSession(c);
  if (!user) return null;
  const alias = await accountProfile(c.env, user.id).getAlias();
  return { ...user, ...(alias ? { alias } : {}) };
}

export function clearAuthSession(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function sealSession(env: Env, issuer: string, user: AuthUser): Promise<string> {
  const session: StoredSession = { issuer, user, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
  return seal(session, env.OIDC_SESSION_SECRET, SESSION_AAD);
}

export async function setSessionCookie(c: AppContext, issuer: string, user: AuthUser): Promise<void> {
  setCookie(c, SESSION_COOKIE, await sealSession(c.env, issuer, user), {
    path: '/',
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    sameSite: 'Lax',
    secure: isSecureRequest(c),
  });
}

export function parseSession(value: unknown, allowLoopback: boolean): StoredSession {
  const data = record(value);
  const user = record(data.user);
  const expiresAt = data.expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) throw new Error('invalid session expiry');
  const picture = optionalPictureUrl(user.picture, allowLoopback);
  return {
    issuer: requiredString(data.issuer, 'OIDC_SESSION_INVALID', 401),
    user: {
      id: requiredString(user.id, 'OIDC_SESSION_INVALID', 401),
      username: requiredString(user.username, 'OIDC_SESSION_INVALID', 401),
      ...(picture ? { picture } : {}),
    },
    expiresAt,
  };
}
