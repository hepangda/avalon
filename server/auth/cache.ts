import { createRemoteJWKSet } from 'jose';
import type { OidcMetadata } from './types';

const TTL_MS = 5 * 60_000;
const MAX_ISSUERS = 32;
const metadata = new Map<string, { until: number; value: Promise<OidcMetadata> }>();
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Coalesce discovery and cache only validated results; failures remain retryable. */
export function cachedDiscovery(key: string, load: () => Promise<OidcMetadata>): Promise<OidcMetadata> {
  const existing = metadata.get(key);
  if (existing && existing.until > Date.now()) return existing.value;
  if (metadata.size >= MAX_ISSUERS) metadata.clear();
  const value = load().catch((error) => {
    if (metadata.get(key)?.value === value) metadata.delete(key);
    throw error;
  });
  metadata.set(key, { until: Date.now() + TTL_MS, value });
  return value;
}

/** The retained jose resolver handles key expiry and refresh on unknown key IDs. */
export function remoteKeys(uri: string) {
  let resolver = keys.get(uri);
  if (!resolver) {
    if (keys.size >= MAX_ISSUERS) keys.clear();
    resolver = createRemoteJWKSet(new URL(uri));
    keys.set(uri, resolver);
  }
  return resolver;
}

/** Discard cached provider state, also used to isolate auth test fixtures. */
export function clearOidcCaches() {
  metadata.clear();
  keys.clear();
}
