import type { AuthUser } from '@/lib/auth/types';
import type { Context } from 'hono';
import type { Env } from '../env';

export type AppContext = Context<{ Bindings: Env }>;

export type AuthStatus = 400 | 401 | 500 | 502 | 503;

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}

export interface OidcConfig {
  issuer: string;
  allowDevelopment: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenSet {
  accessToken: string;
  idToken: string;
}

/** The application session holds only the identity verified at login, never provider tokens. */
export interface StoredSession {
  issuer: string;
  user: AuthUser;
  expiresAt: number;
}

export interface OidcFlow {
  state: string;
  nonce: string;
  verifier: string;
  next: string | null;
  expiresAt: number;
  silent?: boolean;
}

export interface OidcLoginOptions {
  silent?: boolean;
}

export type AuthCallbackUiError = 'denied' | 'login_required' | 'unavailable' | 'invalid_flow' | 'failed';
