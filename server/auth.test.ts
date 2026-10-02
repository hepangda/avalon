import { clearOidcCaches } from './auth/cache';
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  authCallbackUiError,
  authErrorRedirectPath,
  beginOidcLogin,
  completeOidcLogin,
  safeReturnPath,
  validatedOidcMetadata,
} from "./auth";
import { seal, unseal } from './auth/seal';
import { readSession, SESSION_AAD, SESSION_COOKIE, SESSION_TTL_SECONDS, sealSession } from './auth/session';
import type { Env } from './env';
import { startTestAuth } from './test-auth';

const authDevDiscovery = {
  issuer: "http://localhost:17001",
  authorization_endpoint: "http://localhost:17001/oauth/authorize",
  token_endpoint: "http://localhost:17001/oauth/token",
  userinfo_endpoint: "http://localhost:17001/oauth/userinfo",
  jwks_uri: "http://localhost:17001/.well-known/jwks.json",
};

const developmentEnv = {
  OIDC_ISSUER: "http://localhost:17001",
  OIDC_CLIENT_ID: "avalon_local",
  OIDC_CLIENT_SECRET: "client-secret",
  OIDC_SESSION_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ENVIRONMENT: "development",
};

function stubDiscovery() {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(authDevDiscovery)));
}

async function beginInteractiveTestFlow(returnPath: string, env: Record<string, string> = developmentEnv) {
  const header = vi.fn();
  const loginContext = {
    env,
    req: { url: "http://localhost:5173/api/auth/login" },
    header,
  } as unknown as Parameters<typeof beginOidcLogin>[0];
  const authorizationUrl = await beginOidcLogin(loginContext, returnPath, { silent: false });
  const setCookieHeader = header.mock.calls.find(
    ([name]) => String(name).toLowerCase() === "set-cookie",
  )?.[1] as string | undefined;
  expect(setCookieHeader).toBeTruthy();
  const cookie = setCookieHeader?.split(";", 1)[0] ?? "";
  const callbackUrl = "http://localhost:5173/api/auth/callback";
  const callbackHeader = vi.fn();
  const callbackContext = {
    env,
    req: {
      url: callbackUrl,
      raw: new Request(callbackUrl, { headers: { Cookie: cookie } }),
    },
    header: callbackHeader,
  } as unknown as Parameters<typeof completeOidcLogin>[0];
  return {
    authorizationUrl,
    callbackContext,
    callbackHeader,
    state: new URL(authorizationUrl).searchParams.get("state") ?? "",
  };
}

describe("OAuth return paths", () => {
  it("keeps local paths including locale and query state", () => {
    expect(safeReturnPath("/zh?createRoom=1")).toBe("/zh?createRoom=1");
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "",
  ])("rejects an external or malformed redirect: %s", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it("adds a controlled error code to a safe return path", () => {
    expect(authErrorRedirectPath("/en?from=home#identity", "denied")).toBe(
      "/en?from=home&authError=denied#identity",
    );
    expect(
      authErrorRedirectPath("https://attacker.example", "failed"),
    ).toBe("/?authError=failed");
  });
});

describe("silent OIDC authorization", () => {
  it("uses prompt=none and a sealed stateless flow", async () => {
    stubDiscovery();
    try {
      const context = {
        env: developmentEnv,
        req: { url: "http://localhost:5173/api/auth/silent" },
      } as unknown as Parameters<typeof beginOidcLogin>[0];

      const authorizationUrl = new URL(
        await beginOidcLogin(context, "/api/auth/silent/complete", {
          silent: true,
        }),
      );
      expect(authorizationUrl.origin).toBe("http://localhost:17001");
      expect(authorizationUrl.searchParams.get("prompt")).toBe("none");
      expect(authorizationUrl.searchParams.get("state")).toMatch(
        /^silent\.v1\./u,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits prompt for a user-initiated interactive authorization", async () => {
    stubDiscovery();
    try {
      const { authorizationUrl, state } = await beginInteractiveTestFlow("/zh");
      const params = new URL(authorizationUrl).searchParams;
      expect(params.has("prompt")).toBe(false);
      expect(state).not.toMatch(/^silent\./u);
      // Provider tokens are not kept, so neither an API audience nor refresh tokens are requested.
      expect(params.get("scope")).toBe("openid profile");
      expect(params.has("resource")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("OIDC callback errors", () => {
  it.each([
    ["access_denied", "denied"],
    ["login_required", "login_required"],
    ["interaction_required", "login_required"],
    ["temporarily_unavailable", "unavailable"],
    ["unexpected_provider_error", "failed"],
  ] as const)("maps %s to the safe UI code %s", (providerError, expected) => {
    expect(
      authCallbackUiError(
        new AuthError("OIDC_AUTHORIZATION_DENIED", 401),
        providerError,
      ),
    ).toBe(expected);
  });

  it("preserves an interactive flow return path instead of returning JSON", async () => {
    stubDiscovery();
    try {
      const { callbackContext, state } =
        await beginInteractiveTestFlow("/en");

      await expect(
        completeOidcLogin(
          callbackContext,
          new URLSearchParams({
            state,
            error: "access_denied",
          }),
        ),
      ).rejects.toMatchObject({
        name: "OidcCallbackFailure",
        returnPath: "/en",
        silent: false,
        uiCode: "denied",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("turns invalid_grant into an expired-flow UI error", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('.well-known')
      ? Response.json(authDevDiscovery)
      : Response.json({ error: 'invalid_grant', error_description: 'authorization code expired' }, { status: 400 })));
    try {
      const { callbackContext, state } =
        await beginInteractiveTestFlow("/zh");

      await expect(
        completeOidcLogin(
          callbackContext,
          new URLSearchParams({ state, code: "expired-code" }),
        ),
      ).rejects.toMatchObject({
        name: "OidcCallbackFailure",
        returnPath: "/zh",
        silent: false,
        uiCode: "invalid_flow",
        authError: { code: "OIDC_GRANT_INVALID", status: 401 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks prompt=none callback failures as silent", async () => {
    stubDiscovery();
    try {
      const silentContext = {
        env: developmentEnv,
        req: { url: "http://localhost:5173/api/auth/silent" },
      } as unknown as Parameters<typeof beginOidcLogin>[0];
      const authorizationUrl = new URL(
        await beginOidcLogin(
          silentContext,
          "/api/auth/silent/complete",
          { silent: true },
        ),
      );
      const callbackUrl = "http://localhost:5173/api/auth/callback";
      const callbackContext = {
        env: developmentEnv,
        req: { url: callbackUrl, raw: new Request(callbackUrl) },
        header: vi.fn(),
      } as unknown as Parameters<typeof completeOidcLogin>[0];

      await expect(
        completeOidcLogin(
          callbackContext,
          new URLSearchParams({
            state: authorizationUrl.searchParams.get("state") ?? "",
            error: "login_required",
          }),
        ),
      ).rejects.toMatchObject({
        name: "OidcCallbackFailure",
        returnPath: "/api/auth/silent/complete",
        silent: true,
        uiCode: "login_required",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("OIDC discovery validation", () => {
  it("accepts endpoints on the configured issuer", () => {
    expect(validatedOidcMetadata(authDevDiscovery, "http://localhost:17001")).toEqual(authDevDiscovery);
  });

  it("rejects discovery published for another issuer", () => {
    expect(() => validatedOidcMetadata(authDevDiscovery, "https://auth-dev.pangda.app")).toThrowError(AuthError);
  });

  it("rejects an endpoint outside the published issuer origin", () => {
    expect(() =>
      validatedOidcMetadata(
        { ...authDevDiscovery, token_endpoint: "https://attacker.example/token" },
        "http://localhost:17001",
      ),
    ).toThrowError(AuthError);
  });
});

describe("OIDC login and application session", () => {
  it("stores only the verified identity in a seven-day session cookie", async () => {
    const auth = await startTestAuth();
    try {
      const env = { ...auth.env, ENVIRONMENT: "development" };
      const { authorizationUrl, callbackContext, callbackHeader, state } = await beginInteractiveTestFlow("/zh", env);
      const code = auth.authorize(authorizationUrl);

      await expect(completeOidcLogin(callbackContext, new URLSearchParams({ state, code }))).resolves.toBe("/zh");
      const setCookie = callbackHeader.mock.calls
        .map(([, value]) => String(value))
        .find((value) => value.startsWith(`${SESSION_COOKIE}=`)) ?? "";
      expect(setCookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
      expect(setCookie).toContain("HttpOnly");
      const value = setCookie.slice(SESSION_COOKIE.length + 1).split(";", 1)[0] ?? "";
      expect(await unseal(value, env.OIDC_SESSION_SECRET, SESSION_AAD)).toEqual({
        issuer: auth.env.OIDC_ISSUER,
        user: { id: "test-user", username: "Host" },
        expiresAt: expect.any(Number),
      });
      expect(await readSession(env as unknown as Env, value)).toEqual({ id: "test-user", username: "Host" });
    } finally {
      await auth.close();
    }
  });

  it("rejects a PKCE verifier that does not match the authorization request", async () => {
    const auth = await startTestAuth();
    try {
      const env = { ...auth.env, ENVIRONMENT: "development" };
      const first = await beginInteractiveTestFlow("/en", env);
      const second = await beginInteractiveTestFlow("/en", env);
      // A code issued for the first request redeemed with the second request's verifier.
      const code = auth.authorize(first.authorizationUrl);
      await expect(completeOidcLogin(second.callbackContext, new URLSearchParams({ state: second.state, code })))
        .rejects.toMatchObject({ authError: { code: "OIDC_GRANT_INVALID" } });
    } finally {
      await auth.close();
    }
  });

  it("ends at a fixed expiry and rejects other issuers and retired token sessions", async () => {
    const env = developmentEnv as unknown as Env;
    const user = { id: "user-a", username: "Player" };
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T00:00:00Z"));
    try {
      const value = await sealSession(env, developmentEnv.OIDC_ISSUER, user);
      now.mockReturnValue(Date.parse("2026-10-01T00:00:00Z") + SESSION_TTL_SECONDS * 1000 - 1);
      expect(await readSession(env, value)).toEqual(user);
      now.mockReturnValue(Date.parse("2026-10-01T00:00:00Z") + SESSION_TTL_SECONDS * 1000);
      expect(await readSession(env, value)).toBeNull();

      now.mockRestore();
      const otherIssuer = await sealSession(env, "http://127.0.0.1:17002", user);
      expect(await readSession(env, otherIssuer)).toBeNull();
      const retired = await seal({
        accessToken: "access", refreshToken: "refresh", accessTokenExpiresAt: Date.now() + 60_000, user,
      }, developmentEnv.OIDC_SESSION_SECRET, new TextEncoder().encode("avalon:oidc-session:v1"));
      expect(await readSession(env, retired)).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
});

beforeEach(clearOidcCaches);
