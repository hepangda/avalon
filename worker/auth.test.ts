import { describe, expect, it, vi } from "vitest";
import {
  AuthError,
  authCallbackUiError,
  authErrorRedirectPath,
  beginOidcLogin,
  completeOidcLogin,
  normalizedDevelopmentAssetUrl,
  safeReturnPath,
  validatedOidcMetadata,
} from "./auth";

const authDevDiscovery = {
  issuer: "http://localhost:17001",
  authorization_endpoint: "http://localhost:17001/oauth/authorize",
  token_endpoint: "http://localhost:17001/oauth/token",
  userinfo_endpoint: "http://localhost:17001/oauth/userinfo",
  jwks_uri: "http://localhost:17001/.well-known/jwks.json",
};

const developmentEnv = {
  OIDC_ISSUER: "https://auth-dev.pangda.app",
  OIDC_CLIENT_ID: "avalon_local",
  OIDC_CLIENT_SECRET: "client-secret",
  OIDC_RESOURCE: "https://avalon.pangda.app/createRoom",
  OIDC_SESSION_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ENVIRONMENT: "development",
};

async function beginInteractiveTestFlow(returnPath: string) {
  const header = vi.fn();
  const loginContext = {
    env: developmentEnv,
    req: { url: "http://localhost:5173/api/auth/login" },
    header,
  } as unknown as Parameters<typeof beginOidcLogin>[0];
  const authorizationUrl = new URL(
    await beginOidcLogin(loginContext, returnPath, { silent: false }),
  );
  const setCookieHeader = header.mock.calls.find(
    ([name]) => String(name).toLowerCase() === "set-cookie",
  )?.[1] as string | undefined;
  expect(setCookieHeader).toBeTruthy();
  const cookie = setCookieHeader?.split(";", 1)[0] ?? "";
  const callbackUrl = "http://localhost:5173/api/auth/callback";
  const callbackContext = {
    env: developmentEnv,
    req: {
      url: callbackUrl,
      raw: new Request(callbackUrl, { headers: { Cookie: cookie } }),
    },
    header: vi.fn(),
  } as unknown as Parameters<typeof completeOidcLogin>[0];
  return {
    callbackContext,
    state: authorizationUrl.searchParams.get("state") ?? "",
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
    ).toBe("/zh?authError=failed");
  });
});

describe("silent OIDC authorization", () => {
  it("uses prompt=none and a sealed stateless flow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(authDevDiscovery), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    try {
      const context = {
        env: {
          OIDC_ISSUER: "https://auth-dev.pangda.app",
          OIDC_CLIENT_ID: "avalon_local",
          OIDC_CLIENT_SECRET: "client-secret",
          OIDC_RESOURCE: "https://avalon.pangda.app/createRoom",
          OIDC_SESSION_SECRET:
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          ENVIRONMENT: "development",
        },
        req: { url: "http://localhost:5173/api/auth/silent" },
      } as Parameters<typeof beginOidcLogin>[0];

      const authorizationUrl = new URL(
        await beginOidcLogin(context, "/api/auth/silent/complete", {
          silent: true,
        }),
      );
      expect(authorizationUrl.origin).toBe("https://auth-dev.pangda.app");
      expect(authorizationUrl.searchParams.get("prompt")).toBe("none");
      expect(authorizationUrl.searchParams.get("state")).toMatch(
        /^silent\.v1\./u,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits prompt for a user-initiated interactive authorization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(authDevDiscovery), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    try {
      const context = {
        env: {
          OIDC_ISSUER: "https://auth-dev.pangda.app",
          OIDC_CLIENT_ID: "avalon_local",
          OIDC_CLIENT_SECRET: "client-secret",
          OIDC_RESOURCE: "https://avalon.pangda.app/createRoom",
          OIDC_SESSION_SECRET:
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          ENVIRONMENT: "development",
        },
        req: { url: "http://localhost:5173/api/auth/login" },
        header: vi.fn(),
      } as unknown as Parameters<typeof beginOidcLogin>[0];

      const authorizationUrl = new URL(
        await beginOidcLogin(context, "/zh", { silent: false }),
      );
      expect(authorizationUrl.searchParams.has("prompt")).toBe(false);
      expect(authorizationUrl.searchParams.get("state")).not.toMatch(
        /^silent\./u,
      );
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(authDevDiscovery), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
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
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(authDevDiscovery), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(authDevDiscovery), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "authorization code expired",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(authDevDiscovery), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    try {
      const silentContext = {
        env: developmentEnv,
        req: { url: "http://localhost:5173/api/auth/silent" },
      } as Parameters<typeof beginOidcLogin>[0];
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
  it("rebases the known auth-dev proxy endpoints without changing the token issuer", () => {
    expect(
      validatedOidcMetadata(
        authDevDiscovery,
        "https://auth-dev.pangda.app",
        true,
      ),
    ).toEqual({
      ...authDevDiscovery,
      authorization_endpoint: "https://auth-dev.pangda.app/oauth/authorize",
      token_endpoint: "https://auth-dev.pangda.app/oauth/token",
      userinfo_endpoint: "https://auth-dev.pangda.app/oauth/userinfo",
      jwks_uri: "https://auth-dev.pangda.app/.well-known/jwks.json",
    });
  });

  it("rejects the auth-dev issuer alias outside development", () => {
    expect(() =>
      validatedOidcMetadata(
        authDevDiscovery,
        "https://auth-dev.pangda.app",
        false,
      ),
    ).toThrowError(AuthError);
  });

  it("rejects an endpoint outside the published issuer origin", () => {
    expect(() =>
      validatedOidcMetadata(
        {
          ...authDevDiscovery,
          token_endpoint: "https://attacker.example/token",
        },
        "https://auth-dev.pangda.app",
        true,
      ),
    ).toThrowError(AuthError);
  });
});

describe("OIDC development assets", () => {
  it("rebases auth-dev avatar URLs to the public issuer", () => {
    expect(
      normalizedDevelopmentAssetUrl(
        "http://localhost:17001/avatars/admin.webp",
        "https://auth-dev.pangda.app",
        true,
      ),
    ).toBe("https://auth-dev.pangda.app/avatars/admin.webp");
  });

  it("does not rebase unrelated or production asset URLs", () => {
    expect(
      normalizedDevelopmentAssetUrl(
        "https://cdn.example/avatar.webp",
        "https://auth-dev.pangda.app",
        true,
      ),
    ).toBe("https://cdn.example/avatar.webp");
    expect(
      normalizedDevelopmentAssetUrl(
        "http://localhost:17001/avatars/admin.webp",
        "https://auth-dev.pangda.app",
        false,
      ),
    ).toBe("http://localhost:17001/avatars/admin.webp");
  });
});
