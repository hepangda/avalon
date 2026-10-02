import type { AuthUser } from '@/lib/auth/types';
import { jwtVerify } from 'jose';
import { cachedDiscovery, remoteKeys } from './cache';
import { optionalPictureUrl, validatedOidcMetadata } from './config';
import { AuthError } from './errors';
import { OidcConfig, OidcMetadata, TokenSet } from './types';
import { oauthErrorCode, record, requiredString } from './validation';

const PROVIDER_TIMEOUT_MS = 8_000;

export function discoverOidc(config: OidcConfig): Promise<OidcMetadata> {
  return cachedDiscovery(config.issuer, () => fetchDiscovery(config));
}

async function fetchDiscovery(config: OidcConfig): Promise<OidcMetadata> {
  let response: Response;
  try {
    response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('OIDC_UNAVAILABLE', 503);
  }
  if (!response.ok) throw new AuthError('OIDC_UNAVAILABLE', 503);
  return validatedOidcMetadata(await response.json().catch(() => null), config.issuer);
}

/** Redeem an authorization code; the tokens are used once at login and never stored. */
export async function exchangeCode(config: OidcConfig, metadata: OidcMetadata, code: string, verifier: string): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('OIDC_UNAVAILABLE', 503);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (oauthErrorCode(body) === 'invalid_grant') throw new AuthError('OIDC_GRANT_INVALID', 401);
    throw response.status < 500 ? new AuthError('OIDC_SESSION_INVALID', 401) : new AuthError('OIDC_UNAVAILABLE', 503);
  }
  const value = record(body);
  return {
    accessToken: requiredString(value.access_token, 'OIDC_TOKEN_RESPONSE_INVALID'),
    idToken: requiredString(value.id_token, 'OIDC_TOKEN_RESPONSE_INVALID'),
  };
}

/** Verify the ID token for this login attempt and return its subject. */
export async function verifyIdToken(metadata: OidcMetadata, config: OidcConfig, token: string, nonce: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, remoteKeys(metadata.jwks_uri), {
      algorithms: ['RS256'],
      issuer: metadata.issuer,
      audience: config.clientId,
      typ: 'JWT',
    });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.nonce !== nonce) {
      throw new Error('invalid subject or nonce');
    }
    return payload.sub;
  } catch {
    throw new AuthError('OIDC_ID_TOKEN_INVALID', 502);
  }
}

export async function fetchUserInfo(metadata: OidcMetadata, accessToken: string, allowDevelopment: boolean): Promise<AuthUser> {
  let response: Response;
  try {
    response = await fetch(metadata.userinfo_endpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('OIDC_UNAVAILABLE', 503);
  }
  if (response.status === 401 || response.status === 403) throw new AuthError('OIDC_SESSION_INVALID', 401);
  if (!response.ok) throw new AuthError('OIDC_UNAVAILABLE', 503);
  return parseUserInfo(await response.json().catch(() => null), allowDevelopment);
}

export function parseUserInfo(value: unknown, allowDevelopment: boolean): AuthUser {
  const data = record(value);
  const id = requiredString(data.sub, 'OIDC_USERINFO_INVALID');
  const username = requiredString(data.preferred_username, 'OIDC_USERINFO_INVALID').replace(/\s+/gu, ' ').trim();
  if (!username || username.length > 64) throw new AuthError('OIDC_USERINFO_INVALID', 502);
  const picture = optionalPictureUrl(data.picture, allowDevelopment);
  return { id, username, ...(picture ? { picture } : {}) };
}
