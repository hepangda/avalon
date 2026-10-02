import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearOidcCaches, remoteKeys } from './cache';
import { discoverOidc } from './tokens';
import type { OidcConfig } from './types';

const config: OidcConfig = {
  issuer: 'https://auth.pangda.app', allowDevelopment: false,
  clientId: 'test', clientSecret: 'test', redirectUri: 'https://app.example/callback'
};
function metadata(issuer = config.issuer) {
  return { issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', userinfo_endpoint: issuer + '/user', jwks_uri: issuer + '/keys' };
}
beforeEach(clearOidcCaches);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('coalesces discovery, isolates issuers and refreshes expired metadata', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const fetcher = vi.fn(async (url: string) => Response.json(metadata(new URL(url).origin)));
  vi.stubGlobal('fetch', fetcher);
  const [a, b] = await Promise.all([discoverOidc(config), discoverOidc(config)]);
  expect(a).toEqual(b);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await discoverOidc({ ...config, issuer: 'https://auth-staging.pangda.app' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.now() + 300_001);
  await discoverOidc(config);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('never caches rejected metadata or an unavailable provider', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(Response.json({ ...metadata(), token_endpoint: 'https://other.example/token' }))
    .mockImplementation(async () => Response.json(metadata()));
  vi.stubGlobal('fetch', fetcher);
  await expect(discoverOidc(config)).rejects.toThrow();
  await expect(discoverOidc(config)).rejects.toThrow();
  await expect(discoverOidc(config)).resolves.toEqual(metadata());
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('retains the per-URI JWKS resolver across token verifications', () => {
  const uri = metadata().jwks_uri;
  expect(remoteKeys(uri)).toBe(remoteKeys(uri));
  expect(remoteKeys(uri)).not.toBe(remoteKeys('https://auth-staging.pangda.app/keys'));
});
