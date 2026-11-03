import type { AuthUser } from './types';

/**
 * One read of `GET /api/auth/session`. Only the server can say who is signed in;
 * a request that never reaches a working server says nothing about the session.
 */
export type SessionRead = { kind: 'known'; user: AuthUser | null } | { kind: 'unavailable' };

export const SESSION_UNAVAILABLE: SessionRead = { kind: 'unavailable' };

/**
 * A 200 carrying `{ user }` or a 401 is an answer; anything else (5xx during a
 * restart or deploy, a proxy error page, a malformed body) is `unavailable`.
 */
export async function sessionReadFromResponse(response: Response): Promise<SessionRead> {
  if (response.status === 401) return { kind: 'known', user: null };
  if (response.status !== 200) return SESSION_UNAVAILABLE;
  try {
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== 'object' || !('user' in body)) return SESSION_UNAVAILABLE;
    const user = body.user;
    if (user === null) return { kind: 'known', user: null };
    if (typeof user === 'object' && typeof (user as { id?: unknown }).id === 'string')
      return { kind: 'known', user: user as AuthUser };
    return SESSION_UNAVAILABLE;
  } catch {
    return SESSION_UNAVAILABLE;
  }
}

export type RefreshDecision =
  | { action: 'keep' }
  | { action: 'renew' }
  | { action: 'apply'; user: AuthUser | null };

/**
 * How a background `refresh()` treats a read: an unavailable server keeps the
 * current account, and only a confirmed sign-out of a signed-in account is
 * worth a silent `prompt=none` renewal.
 */
export function refreshDecision(read: SessionRead, signedIn: boolean): RefreshDecision {
  if (read.kind === 'unavailable') return { action: 'keep' };
  if (!read.user && signedIn) return { action: 'renew' };
  return { action: 'apply', user: read.user };
}

const INITIAL_RETRY_MIN_MS = 1_000;
const INITIAL_RETRY_MAX_MS = 30_000;

/** Backoff between initial-load session reads while the server is unavailable. */
export function initialRetryDelay(attempt: number): number {
  return Math.min(INITIAL_RETRY_MAX_MS, INITIAL_RETRY_MIN_MS * 2 ** attempt);
}
