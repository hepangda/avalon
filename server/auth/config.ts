import type { Env } from '../env';
import { AuthError } from './errors';
import { AppContext, OidcConfig, OidcMetadata } from './types';
import { absoluteUrl, record } from './validation';

export const APPROVED_ISSUERS = ['https://auth.pangda.app', 'https://auth-staging.pangda.app'];

/** The configured issuer origin; development additionally accepts a loopback provider. */
export function oidcIssuer(env: Env): string {
  const allowLoopback = allowsLoopback(env);
  const issuer = normalizedOrigin(env.OIDC_ISSUER, 'OIDC_ISSUER', allowLoopback);
  if (!APPROVED_ISSUERS.includes(issuer) && !(allowLoopback && isLoopbackOrigin(issuer))) {
    throw new AuthError('OIDC_NOT_CONFIGURED', 503, 'OIDC_ISSUER is not approved');
  }
  return issuer;
}

export function oidcConfig(env: Env, appOrigin: string): OidcConfig {
  const issuer = oidcIssuer(env);
  const allowLoopback = allowsLoopback(env);
  const origin = normalizedOrigin(appOrigin, 'application origin', allowLoopback);
  const clientId = env.OIDC_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) {
    throw new AuthError('OIDC_NOT_CONFIGURED', 503, 'OIDC client credentials are missing');
  }
  return { issuer, allowDevelopment: allowLoopback, clientId, clientSecret, redirectUri: `${origin}/api/auth/callback` };
}

export function normalizedOrigin(value: string | undefined, variable: string, allowLoopback: boolean): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new AuthError('OIDC_NOT_CONFIGURED', 503, `${variable} must be an absolute URL`);
  }
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/') {
    throw new AuthError('OIDC_NOT_CONFIGURED', 503, `${variable} must contain only an origin`);
  }
  if (url.protocol !== 'https:' && !(allowLoopback && isLoopbackOrigin(url.origin))) {
    throw new AuthError('OIDC_NOT_CONFIGURED', 503, `${variable} must use HTTPS`);
  }
  return url.origin;
}

/** Discovery must name the configured issuer and keep every endpoint on its origin. */
export function validatedOidcMetadata(value: unknown, issuer: string): OidcMetadata {
  const metadata = parseMetadata(value);
  if (metadata.issuer !== issuer) throw new AuthError('OIDC_DISCOVERY_INVALID', 502);
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.userinfo_endpoint, metadata.jwks_uri]) {
    if (new URL(endpoint).origin !== issuer) throw new AuthError('OIDC_DISCOVERY_INVALID', 502);
  }
  return metadata;
}

export function parseMetadata(value: unknown): OidcMetadata {
  const data = record(value);
  return {
    issuer: absoluteUrl(data.issuer, 'OIDC_DISCOVERY_INVALID'),
    authorization_endpoint: absoluteUrl(data.authorization_endpoint, 'OIDC_DISCOVERY_INVALID'),
    token_endpoint: absoluteUrl(data.token_endpoint, 'OIDC_DISCOVERY_INVALID'),
    userinfo_endpoint: absoluteUrl(data.userinfo_endpoint, 'OIDC_DISCOVERY_INVALID'),
    jwks_uri: absoluteUrl(data.jwks_uri, 'OIDC_DISCOVERY_INVALID'),
  };
}

export function optionalPictureUrl(value: unknown, allowLoopback: boolean): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 2048) {
    throw new AuthError('OIDC_USERINFO_INVALID', 502);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(allowLoopback && isLoopbackOrigin(url.origin))) {
      throw new Error('picture must use HTTPS');
    }
    return url.toString();
  } catch {
    throw new AuthError('OIDC_USERINFO_INVALID', 502);
  }
}

export function isSecureRequest(c: AppContext): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export function allowsLoopback(env: Env): boolean {
  return (env.ENVIRONMENT ?? 'production') !== 'production';
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}
