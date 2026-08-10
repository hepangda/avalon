import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

const FLOW_COOKIE = "avalon_oidc_flow";
const SESSION_COOKIE = "avalon_oidc_session";
const FLOW_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;
const OIDC_SCOPES = "openid profile offline_access";
const SILENT_STATE_PREFIX = "silent.";
const APPROVED_ISSUERS = [
  "https://auth.pangda.app",
  "https://auth-staging.pangda.app",
];
const DEVELOPMENT_ISSUER_ALIASES: Readonly<Record<string, string>> = {
  "https://auth-dev.pangda.app": "http://localhost:17001",
};
const FLOW_AAD = new TextEncoder().encode("avalon:oidc-flow:v1");
const SESSION_AAD = new TextEncoder().encode("avalon:oidc-session:v1");

type AppContext = Context<{ Bindings: Env }>;
type AuthStatus = 400 | 401 | 502 | 503;

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}

interface OidcConfig {
  issuer: string;
  allowDevelopment: boolean;
  clientId: string;
  clientSecret: string;
  resource: string;
  redirectUri: string;
}

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accessTokenExpiresAt: number;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  user: AuthUser;
}

interface OidcFlow {
  state: string;
  nonce: string;
  verifier: string;
  next: string | null;
  expiresAt: number;
  silent?: boolean;
}

interface OidcLoginOptions {
  silent?: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  picture?: string;
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: AuthStatus,
    message = code,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

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
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  const params = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: OIDC_SCOPES,
    resource: config.resource,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
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
      "state",
      `${SILENT_STATE_PREFIX}${await seal(flow, c.env.OIDC_SESSION_SECRET, FLOW_AAD)}`,
    );
    authorizationUrl.searchParams.set("prompt", "none");
  } else {
    // Interactive login must never inherit prompt=none from a discovery URL.
    authorizationUrl.searchParams.delete("prompt");
    authorizationUrl.searchParams.set("state", state);
    setCookie(
      c,
      FLOW_COOKIE,
      await seal(flow, c.env.OIDC_SESSION_SECRET, FLOW_AAD),
      {
        path: "/",
        httpOnly: true,
        maxAge: FLOW_TTL_MS / 1000,
        sameSite: "Lax",
        secure: isSecureRequest(c),
      },
    );
  }
  return authorizationUrl.toString();
}

/** Finish the OIDC flow and create an encrypted, HttpOnly application session. */
export async function completeOidcLogin(
  c: AppContext,
  query: URLSearchParams,
): Promise<string | null> {
  const returnedState = query.get("state");
  const silentState = returnedState?.startsWith(SILENT_STATE_PREFIX)
    ? returnedState.slice(SILENT_STATE_PREFIX.length)
    : null;
  const sealedFlow = silentState ?? getCookie(c, FLOW_COOKIE);
  if (!silentState) deleteCookie(c, FLOW_COOKIE, { path: "/" });
  if (!sealedFlow) throw new AuthError("OIDC_FLOW_INVALID", 400);

  let flow: OidcFlow;
  try {
    flow = parseFlow(
      await unseal(sealedFlow, c.env.OIDC_SESSION_SECRET, FLOW_AAD),
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("OIDC_FLOW_INVALID", 400);
  }
  if (
    flow.expiresAt <= Date.now() ||
    (silentState ? !flow.silent : returnedState !== flow.state)
  ) {
    throw new AuthError("OIDC_FLOW_INVALID", 400);
  }
  if (query.get("error")) throw new AuthError("OIDC_AUTHORIZATION_DENIED", 401);
  const code = query.get("code");
  if (!code) throw new AuthError("OIDC_FLOW_INVALID", 400);

  const config = oidcConfig(c.env, new URL(c.req.url).origin);
  const metadata = await discoverOidc(config);
  const tokens = await exchangeTokens(
    config,
    metadata,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: flow.verifier,
    }),
  );
  const subject = await verifyIdToken(
    metadata,
    config,
    tokens.idToken,
    flow.nonce,
  );
  await verifyAccessToken(metadata, config, tokens.accessToken, subject);
  const user = await fetchUserInfo(
    metadata,
    tokens.accessToken,
    allowsLoopback(c.env),
    config.issuer,
  );
  if (user.id !== subject) throw new AuthError("OIDC_USERINFO_INVALID", 502);
  await setSessionCookie(c, storedSession(tokens, user));
  return flow.next;
}

/** Return a valid create-room identity, refreshing and re-checking its API token when needed. */
export async function getCurrentAuthUser(
  c: AppContext,
): Promise<AuthUser | null> {
  const encoded = getCookie(c, SESSION_COOKIE);
  if (!encoded) return null;

  let session: StoredSession;
  try {
    session = parseSession(
      await unseal(encoded, c.env.OIDC_SESSION_SECRET, SESSION_AAD),
      allowsLoopback(c.env),
    );
  } catch (error) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    if (error instanceof AuthError && error.code === "OIDC_NOT_CONFIGURED")
      throw error;
    return null;
  }

  const config = oidcConfig(c.env, new URL(c.req.url).origin);
  const metadata = await discoverOidc(config);
  if (session.accessTokenExpiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
    try {
      const tokens = await exchangeTokens(
        config,
        metadata,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
        }),
      );
      const subject = await verifyIdToken(metadata, config, tokens.idToken);
      if (subject !== session.user.id)
        throw new AuthError("OIDC_SESSION_INVALID", 401);
      await verifyAccessToken(metadata, config, tokens.accessToken, subject);
      const user = await fetchUserInfo(
        metadata,
        tokens.accessToken,
        allowsLoopback(c.env),
        config.issuer,
      );
      if (user.id !== subject)
        throw new AuthError("OIDC_USERINFO_INVALID", 502);
      session = storedSession(tokens, user);
      await setSessionCookie(c, session);
    } catch (error) {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      if (error instanceof AuthError && error.status >= 500) throw error;
      return null;
    }
  } else {
    try {
      await verifyAccessToken(
        metadata,
        config,
        session.accessToken,
        session.user.id,
      );
    } catch {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return null;
    }
  }
  return session.user;
}

export function clearAuthSession(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function safeReturnPath(
  value: string | null | undefined,
): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }
  const base = new URL("https://avalon.invalid");
  const parsed = new URL(value, base);
  return parsed.origin === base.origin
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : null;
}

function oidcConfig(env: Env, appOrigin: string): OidcConfig {
  const allowLoopback = allowsLoopback(env);
  const issuer = normalizedOrigin(
    env.OIDC_ISSUER,
    "OIDC_ISSUER",
    allowLoopback,
  );
  if (
    !APPROVED_ISSUERS.includes(issuer) &&
    !(allowLoopback && issuer in DEVELOPMENT_ISSUER_ALIASES) &&
    !(allowLoopback && isLoopbackOrigin(issuer))
  ) {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_ISSUER is not approved",
    );
  }
  const origin = normalizedOrigin(
    appOrigin,
    "application origin",
    allowLoopback,
  );
  const clientId = env.OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC client credentials are missing",
    );
  }
  const resource = resourceUri(env.OIDC_RESOURCE);
  return {
    issuer,
    allowDevelopment: allowLoopback,
    clientId,
    clientSecret,
    resource,
    redirectUri: `${origin}/api/auth/callback`,
  };
}

function normalizedOrigin(
  value: string | undefined,
  variable: string,
  allowLoopback: boolean,
): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      `${variable} must be an absolute URL`,
    );
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/"
  ) {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      `${variable} must contain only an origin`,
    );
  }
  if (
    url.protocol !== "https:" &&
    !(allowLoopback && isLoopbackOrigin(url.origin))
  ) {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      `${variable} must use HTTPS`,
    );
  }
  return url.origin;
}

function resourceUri(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid resource");
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_RESOURCE must be an HTTPS URL",
    );
  }
}

async function discoverOidc(config: OidcConfig): Promise<OidcMetadata> {
  let response: Response;
  try {
    response = await fetch(
      `${config.issuer}/.well-known/openid-configuration`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    throw new AuthError("OIDC_UNAVAILABLE", 503);
  }
  if (!response.ok) throw new AuthError("OIDC_UNAVAILABLE", 503);
  return validatedOidcMetadata(
    await response.json().catch(() => null),
    config.issuer,
    config.allowDevelopment,
  );
}

/** Validate discovery and normalize the known auth-dev proxy origin in development only. */
export function validatedOidcMetadata(
  value: unknown,
  issuer: string,
  allowDevelopment: boolean,
): OidcMetadata {
  const metadata = parseMetadata(value);
  const publishedIssuer =
    (allowDevelopment ? DEVELOPMENT_ISSUER_ALIASES[issuer] : undefined) ??
    issuer;
  if (metadata.issuer !== publishedIssuer) {
    throw new AuthError("OIDC_DISCOVERY_INVALID", 502);
  }
  const issuerOrigin = new URL(publishedIssuer).origin;
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.userinfo_endpoint,
    metadata.jwks_uri,
  ]) {
    if (new URL(endpoint).origin !== issuerOrigin) {
      throw new AuthError("OIDC_DISCOVERY_INVALID", 502);
    }
  }
  if (publishedIssuer === issuer) return metadata;
  return {
    ...metadata,
    authorization_endpoint: replaceOrigin(
      metadata.authorization_endpoint,
      issuer,
    ),
    token_endpoint: replaceOrigin(metadata.token_endpoint, issuer),
    userinfo_endpoint: replaceOrigin(metadata.userinfo_endpoint, issuer),
    jwks_uri: replaceOrigin(metadata.jwks_uri, issuer),
  };
}

function replaceOrigin(value: string, origin: string): string {
  const source = new URL(value);
  const target = new URL(origin);
  source.protocol = target.protocol;
  source.hostname = target.hostname;
  source.port = target.port;
  return source.toString();
}

async function exchangeTokens(
  config: OidcConfig,
  metadata: OidcMetadata,
  body: URLSearchParams,
): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AuthError("OIDC_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    throw new AuthError(
      response.status < 500 ? "OIDC_SESSION_INVALID" : "OIDC_UNAVAILABLE",
      response.status < 500 ? 401 : 503,
    );
  }
  const value = record(await response.json().catch(() => null));
  const accessToken = requiredString(
    value.access_token,
    "OIDC_TOKEN_RESPONSE_INVALID",
  );
  const refreshToken = requiredString(
    value.refresh_token,
    "OIDC_TOKEN_RESPONSE_INVALID",
  );
  const idToken = requiredString(value.id_token, "OIDC_TOKEN_RESPONSE_INVALID");
  const expiresIn = value.expires_in;
  if (
    value.token_type !== "Bearer" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new AuthError("OIDC_TOKEN_RESPONSE_INVALID", 502);
  }
  return {
    accessToken,
    refreshToken,
    idToken,
    accessTokenExpiresAt: Date.now() + Math.floor(expiresIn) * 1000,
  };
}

async function verifyIdToken(
  metadata: OidcMetadata,
  config: OidcConfig,
  token: string,
  nonce?: string,
): Promise<string> {
  try {
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(metadata.jwks_uri)),
      {
        algorithms: ["RS256"],
        issuer: metadata.issuer,
        audience: config.clientId,
        typ: "JWT",
      },
    );
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      (nonce && payload.nonce !== nonce)
    ) {
      throw new Error("invalid subject or nonce");
    }
    return payload.sub;
  } catch {
    throw new AuthError("OIDC_ID_TOKEN_INVALID", 502);
  }
}

async function verifyAccessToken(
  metadata: OidcMetadata,
  config: OidcConfig,
  token: string,
  subject: string,
): Promise<void> {
  try {
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(metadata.jwks_uri)),
      {
        algorithms: ["RS256"],
        issuer: metadata.issuer,
        audience: config.resource,
        typ: "at+jwt",
      },
    );
    if (payload.sub !== subject || payload.token_use !== "access_token") {
      throw new Error("wrong token identity or use");
    }
  } catch {
    throw new AuthError("CREATE_ROOM_TOKEN_INVALID", 401);
  }
}

async function fetchUserInfo(
  metadata: OidcMetadata,
  accessToken: string,
  allowDevelopment: boolean,
  issuer: string,
): Promise<AuthUser> {
  let response: Response;
  try {
    response = await fetch(metadata.userinfo_endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AuthError("OIDC_UNAVAILABLE", 503);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AuthError("OIDC_SESSION_INVALID", 401);
  }
  if (!response.ok) throw new AuthError("OIDC_UNAVAILABLE", 503);
  return parseUserInfo(
    await response.json().catch(() => null),
    allowDevelopment,
    issuer,
  );
}

function parseUserInfo(
  value: unknown,
  allowDevelopment: boolean,
  issuer: string,
): AuthUser {
  const data = record(value);
  const id = requiredString(data.sub, "OIDC_USERINFO_INVALID");
  const username = requiredString(
    data.preferred_username,
    "OIDC_USERINFO_INVALID",
  )
    .replace(/\s+/gu, " ")
    .trim();
  if (!username || username.length > 64)
    throw new AuthError("OIDC_USERINFO_INVALID", 502);
  const picture = optionalPictureUrl(data.picture, allowDevelopment);
  const publicPicture = picture
    ? normalizedDevelopmentAssetUrl(picture, issuer, allowDevelopment)
    : undefined;
  return { id, username, ...(publicPicture ? { picture: publicPicture } : {}) };
}

export function normalizedDevelopmentAssetUrl(
  value: string,
  issuer: string,
  allowDevelopment: boolean,
): string {
  const publishedIssuer = allowDevelopment
    ? DEVELOPMENT_ISSUER_ALIASES[issuer]
    : undefined;
  if (
    !publishedIssuer ||
    new URL(value).origin !== new URL(publishedIssuer).origin
  )
    return value;
  return replaceOrigin(value, issuer);
}

async function setSessionCookie(
  c: AppContext,
  session: StoredSession,
): Promise<void> {
  setCookie(
    c,
    SESSION_COOKIE,
    await seal(session, c.env.OIDC_SESSION_SECRET, SESSION_AAD),
    {
      path: "/",
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
      sameSite: "Lax",
      secure: isSecureRequest(c),
    },
  );
}

function parseMetadata(value: unknown): OidcMetadata {
  const data = record(value);
  return {
    issuer: absoluteUrl(data.issuer, "OIDC_DISCOVERY_INVALID"),
    authorization_endpoint: absoluteUrl(
      data.authorization_endpoint,
      "OIDC_DISCOVERY_INVALID",
    ),
    token_endpoint: absoluteUrl(data.token_endpoint, "OIDC_DISCOVERY_INVALID"),
    userinfo_endpoint: absoluteUrl(
      data.userinfo_endpoint,
      "OIDC_DISCOVERY_INVALID",
    ),
    jwks_uri: absoluteUrl(data.jwks_uri, "OIDC_DISCOVERY_INVALID"),
  };
}

function parseFlow(value: unknown): OidcFlow {
  const data = record(value);
  const expiresAt = data.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new AuthError("OIDC_FLOW_INVALID", 400);
  }
  return {
    state: requiredString(data.state, "OIDC_FLOW_INVALID", 400),
    nonce: requiredString(data.nonce, "OIDC_FLOW_INVALID", 400),
    verifier: requiredString(data.verifier, "OIDC_FLOW_INVALID", 400),
    next:
      data.next === null
        ? null
        : safeReturnPath(requiredString(data.next, "OIDC_FLOW_INVALID", 400)),
    expiresAt,
    ...(data.silent === true ? { silent: true } : {}),
  };
}

function parseSession(value: unknown, allowLoopback: boolean): StoredSession {
  const data = record(value);
  const user = record(data.user);
  const accessTokenExpiresAt = data.accessTokenExpiresAt;
  if (
    typeof accessTokenExpiresAt !== "number" ||
    !Number.isFinite(accessTokenExpiresAt)
  ) {
    throw new Error("invalid session expiry");
  }
  const picture = optionalPictureUrl(user.picture, allowLoopback);
  return {
    accessToken: requiredString(data.accessToken, "OIDC_SESSION_INVALID", 401),
    refreshToken: requiredString(
      data.refreshToken,
      "OIDC_SESSION_INVALID",
      401,
    ),
    accessTokenExpiresAt,
    user: {
      id: requiredString(user.id, "OIDC_SESSION_INVALID", 401),
      username: requiredString(user.username, "OIDC_SESSION_INVALID", 401),
      ...(picture ? { picture } : {}),
    },
  };
}

function storedSession(tokens: TokenSet, user: AuthUser): StoredSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    user,
  };
}

async function seal(
  value: unknown,
  secret: string | undefined,
  aad: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function unseal(
  value: string,
  secret: string | undefined,
  aad: Uint8Array,
): Promise<unknown> {
  const [version, encodedIv, encodedCiphertext, extra] = value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedCiphertext ||
    extra !== undefined
  ) {
    throw new Error("invalid sealed value");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(base64UrlToBytes(encodedIv)),
      additionalData: aad,
    },
    await encryptionKey(secret),
    ownedBuffer(base64UrlToBytes(encodedCiphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

async function encryptionKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret)
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_SESSION_SECRET is missing",
    );
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(secret);
  } catch {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_SESSION_SECRET is invalid",
    );
  }
  if (bytes.byteLength !== 32) {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_SESSION_SECRET must contain 32 bytes",
    );
  }
  return crypto.subtle.importKey("raw", ownedBuffer(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function randomToken(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("OIDC_RESPONSE_INVALID", 502);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  code: string,
  status: AuthStatus = 502,
): string {
  if (typeof value !== "string" || !value) throw new AuthError(code, status);
  return value;
}

function absoluteUrl(value: unknown, code: string): string {
  const raw = requiredString(value, code);
  try {
    new URL(raw);
    return raw;
  } catch {
    throw new AuthError(code, 502);
  }
}

function optionalPictureUrl(
  value: unknown,
  allowLoopback: boolean,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > 2048) {
    throw new AuthError("OIDC_USERINFO_INVALID", 502);
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(allowLoopback && isLoopbackOrigin(url.origin))
    ) {
      throw new Error("picture must use HTTPS");
    }
    return url.toString();
  } catch {
    throw new AuthError("OIDC_USERINFO_INVALID", 502);
  }
}

function isSecureRequest(c: AppContext): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function allowsLoopback(env: Env): boolean {
  return (env.ENVIRONMENT ?? "production") !== "production";
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}
