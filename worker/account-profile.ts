import type { Env } from './env';

/** The subject always comes from the verified session, never from a request body. */
export function accountProfile(env: Env, subject: string) {
  const issuer = new URL(env.OIDC_ISSUER!).origin;
  return env.ACCOUNT_PROFILE.get(env.ACCOUNT_PROFILE.idFromName(JSON.stringify([issuer, subject])));
}
