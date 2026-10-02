import type { DisplayPreferences } from '@/lib/preferences';
import type { Env } from './env';
import { sanitizeName } from '@/lib/game/displayName';

export function accountKey(issuer: string, subject: string): string {
  return JSON.stringify([new URL(issuer).origin, subject]);
}

/** The subject always comes from the verified session, never from a request body. */
export function accountProfile(env: Env, subject: string) {
  const account = accountKey(env.OIDC_ISSUER!, subject);
  return {
    getCards: (claimAt?: number) => env.persistence.getCards(account, claimAt),
    getPreferences: () => env.persistence.getPreferences(account),
    savePreferences: (patch: Partial<DisplayPreferences>) => env.persistence.savePreferences(account, patch),
    getAlias: () => env.persistence.getAlias(account),
    setAlias: (value: string) => {
      const alias = sanitizeName(value);
      if (!alias) throw new Error('Alias cannot be empty');
      return env.persistence.setAlias(account, alias);
    },
  };
}
