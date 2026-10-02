import { AuthError } from './errors';
import { AuthStatus } from './types';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("OIDC_RESPONSE_INVALID", 502);
  }
  return value as Record<string, unknown>;
}

export function oauthErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error.toLowerCase() : null;
}

export function requiredString(
  value: unknown,
  code: string,
  status: AuthStatus = 502,
): string {
  if (typeof value !== "string" || !value) throw new AuthError(code, status);
  return value;
}

export function absoluteUrl(value: unknown, code: string): string {
  const raw = requiredString(value, code);
  try {
    new URL(raw);
    return raw;
  } catch {
    throw new AuthError(code, 502);
  }
}
