import { describe, expect, it, vi } from "vitest";
import {
  AuthError,
  beginOidcLogin,
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
