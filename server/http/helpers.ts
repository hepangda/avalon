import { type Context } from 'hono';
import {
  AuthError,
  OidcCallbackFailure,
  getCurrentAuthUser
} from '../auth';
import type { Env } from '../env';

export function roomObject(env: Env, code: string) {
  return env.rooms.get(code);
}

export async function requireAccount(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
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

export function authErrorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
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

export function logAuthNavigationError(error: unknown) {
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
