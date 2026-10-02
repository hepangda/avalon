import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { allowsLoopback, isSecureRequest, oidcConfig } from './config';
import { AuthError, OidcCallbackFailure, authCallbackUiError, safeReturnPath } from './errors';
import { bytesToBase64Url, randomToken, seal, unseal } from './seal';
import { setSessionCookie } from './session';
import { discoverOidc, exchangeCode, fetchUserInfo, verifyIdToken } from './tokens';
import { AppContext, OidcFlow, OidcLoginOptions } from './types';
import { record, requiredString } from './validation';

export const FLOW_COOKIE = 'avalon_oidc_flow';

export const FLOW_TTL_MS = 10 * 60 * 1000;

export const OIDC_SCOPES = 'openid profile';

export const SILENT_STATE_PREFIX = 'silent.';

export const FLOW_AAD = new TextEncoder().encode('avalon:oidc-flow:v1');

/** Start a Pangda Auth OIDC authorization-code flow with S256 PKCE. */
export async function beginOidcLogin(
  c: AppContext,
  requestedPath: string | null | undefined,
  options: OidcLoginOptions = {},
): Promise<string> {
  const config = oidcConfig(c.env, new URL(c.req.url).origin);
  const metadata = await discoverOidc(config);
  const verifier = randomToken(32);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const challenge = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  const params = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: OIDC_SCOPES,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
  for (const [key, value] of Object.entries(params)) {
    authorizationUrl.searchParams.set(key, value);
  }

  const flow: OidcFlow = {
    state,
    nonce,
    verifier,
    next: safeReturnPath(requestedPath),
    expiresAt: Date.now() + FLOW_TTL_MS,
    ...(options.silent ? { silent: true } : {}),
  };
  if (options.silent) {
    // Silent authorization runs in a hidden iframe. Encode the short-lived,
    // authenticated flow in `state` because SameSite cookies are not reliable
    // on the cross-site iframe callback. The PKCE verifier and nonce remain
    // encrypted with the application session secret.
    authorizationUrl.searchParams.set(
      'state',
      `${SILENT_STATE_PREFIX}${await seal(flow, c.env.OIDC_SESSION_SECRET, FLOW_AAD)}`,
    );
    authorizationUrl.searchParams.set('prompt', 'none');
  } else {
    // Interactive login must never inherit prompt=none from a discovery URL.
    authorizationUrl.searchParams.delete('prompt');
    authorizationUrl.searchParams.set('state', state);
    setCookie(c, FLOW_COOKIE, await seal(flow, c.env.OIDC_SESSION_SECRET, FLOW_AAD), {
      path: '/',
      httpOnly: true,
      maxAge: FLOW_TTL_MS / 1000,
      sameSite: 'Lax',
      secure: isSecureRequest(c),
    });
  }
  return authorizationUrl.toString();
}

/** Finish the OIDC flow and create an encrypted, HttpOnly application session. */
export async function completeOidcLogin(c: AppContext, query: URLSearchParams): Promise<string | null> {
  const returnedState = query.get('state');
  const silentState = returnedState?.startsWith(SILENT_STATE_PREFIX)
    ? returnedState.slice(SILENT_STATE_PREFIX.length)
    : null;
  const sealedFlow = silentState ?? getCookie(c, FLOW_COOKIE);
  if (!silentState) deleteCookie(c, FLOW_COOKIE, { path: '/' });
  if (!sealedFlow) throw new AuthError('OIDC_FLOW_INVALID', 400);

  let flow: OidcFlow;
  try {
    flow = parseFlow(await unseal(sealedFlow, c.env.OIDC_SESSION_SECRET, FLOW_AAD));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('OIDC_FLOW_INVALID', 400);
  }
  if (flow.expiresAt <= Date.now() || (silentState ? !flow.silent : returnedState !== flow.state)) {
    throw new AuthError('OIDC_FLOW_INVALID', 400);
  }
  const providerError = query.get('error');
  try {
    if (providerError) throw new AuthError('OIDC_AUTHORIZATION_DENIED', 401);
    const code = query.get('code');
    if (!code) throw new AuthError('OIDC_FLOW_INVALID', 400);

    const config = oidcConfig(c.env, new URL(c.req.url).origin);
    const metadata = await discoverOidc(config);
    const tokens = await exchangeCode(config, metadata, code, flow.verifier);
    const subject = await verifyIdToken(metadata, config, tokens.idToken, flow.nonce);
    const user = await fetchUserInfo(metadata, tokens.accessToken, allowsLoopback(c.env));
    if (user.id !== subject) throw new AuthError('OIDC_USERINFO_INVALID', 502);
    await setSessionCookie(c, config.issuer, user);
    return flow.next;
  } catch (error) {
    throw new OidcCallbackFailure(error, flow.next, Boolean(flow.silent), authCallbackUiError(error, providerError));
  }
}

export function isSilentOidcCallback(query: URLSearchParams): boolean {
  return query.get('state')?.startsWith(SILENT_STATE_PREFIX) ?? false;
}

export function parseFlow(value: unknown): OidcFlow {
  const data = record(value);
  const expiresAt = data.expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    throw new AuthError('OIDC_FLOW_INVALID', 400);
  }
  return {
    state: requiredString(data.state, 'OIDC_FLOW_INVALID', 400),
    nonce: requiredString(data.nonce, 'OIDC_FLOW_INVALID', 400),
    verifier: requiredString(data.verifier, 'OIDC_FLOW_INVALID', 400),
    next: data.next === null ? null : safeReturnPath(requiredString(data.next, 'OIDC_FLOW_INVALID', 400)),
    expiresAt,
    ...(data.silent === true ? { silent: true } : {}),
  };
}
