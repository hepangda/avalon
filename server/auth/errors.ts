import { AuthCallbackUiError, AuthStatus } from './types';

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

export class OidcCallbackFailure extends Error {
  readonly authError: AuthError;

  constructor(
    readonly originalError: unknown,
    readonly returnPath: string | null,
    readonly silent: boolean,
    readonly uiCode: AuthCallbackUiError,
  ) {
    const authError =
      originalError instanceof AuthError
        ? originalError
        : new AuthError("AUTH_FAILED", 500, "Authentication failed");
    super(authError.message);
    this.name = "OidcCallbackFailure";
    this.authError = authError;
  }
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

export function authCallbackUiError(
  error: unknown,
  providerError?: string | null,
): AuthCallbackUiError {
  switch (providerError?.toLowerCase()) {
    case "access_denied":
      return "denied";
    case "interaction_required":
    case "login_required":
      return "login_required";
    case "server_error":
    case "temporarily_unavailable":
      return "unavailable";
  }
  if (error instanceof AuthError) {
    if (
      error.code === "OIDC_FLOW_INVALID" ||
      error.code === "OIDC_GRANT_INVALID"
    ) {
      return "invalid_flow";
    }
    if (
      error.code === "OIDC_NOT_CONFIGURED" ||
      error.code === "OIDC_UNAVAILABLE"
    ) {
      return "unavailable";
    }
  }
  return "failed";
}

export function authErrorRedirectPath(
  requestedPath: string | null | undefined,
  code: AuthCallbackUiError,
): string {
  const url = new URL(
    safeReturnPath(requestedPath) ?? "/",
    "https://avalon.invalid",
  );
  url.searchParams.set("authError", code);
  return `${url.pathname}${url.search}${url.hash}`;
}
