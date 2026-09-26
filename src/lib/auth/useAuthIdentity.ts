import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSessionStore } from '@/lib/store/session';
import { accountDisplayName, type AuthUser } from './types';

export type { AuthUser } from './types';

const SILENT_AUTH_TIMEOUT_MS = 6_000;
let silentAuthDisabled =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('authError');
let silentAuthPromise: Promise<AuthUser | null> | null = null;
let cancelSilentAuthAttempt: (() => void) | null = null;

async function readAuthUser(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/session', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return ((await response.json()) as { user: AuthUser | null }).user;
}

function rememberIdentity(user: AuthUser | null): void {
  if (user) useSessionStore.getState().setAccountIdentity(accountDisplayName(user), user.picture);
}

function attemptSilentAuth(): Promise<AuthUser | null> {
  if (silentAuthDisabled) return Promise.resolve(null);
  if (silentAuthPromise) return silentAuthPromise;

  silentAuthPromise = new Promise<AuthUser | null>((resolve) => {
    const frame = document.createElement('iframe');
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      cancelSilentAuthAttempt = null;
      const user = await readAuthUser().catch(() => null);
      frame.remove();
      resolve(user);
    };
    cancelSilentAuthAttempt = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      frame.remove();
      cancelSilentAuthAttempt = null;
      resolve(null);
    };
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.src = '/api/auth/silent';
    frame.addEventListener('load', () => void finish(), { once: true });
    document.body.appendChild(frame);
    const timer = window.setTimeout(() => void finish(), SILENT_AUTH_TIMEOUT_MS);
  });
  return silentAuthPromise;
}

function disableSilentAuth(): void {
  silentAuthDisabled = true;
  cancelSilentAuthAttempt?.();
}

/**
 * Read the local Avalon session, then make one best-effort `prompt=none` OIDC
 * attempt in a hidden iframe. Failure remains anonymous and never navigates the
 * visible page away from the current route.
 */
function useAuthIdentityState() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const identityVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++identityVersion.current;
    const next = await readAuthUser().catch(() => null);
    if (version !== identityVersion.current) return next;
    rememberIdentity(next);
    setUser(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    const version = identityVersion.current;

    void readAuthUser()
      .catch(() => null)
      .then((existing) => {
        if (!active || version !== identityVersion.current) return;
        rememberIdentity(existing);
        setUser(existing);
        setLoading(false);
        if (existing) return;
        void attemptSilentAuth().then((discovered) => {
          if (!active || !discovered || version !== identityVersion.current) return;
          rememberIdentity(discovered);
          setUser(discovered);
        });
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback((nextPath: string) => {
    // A user-initiated sign-in is interactive. Stop any background
    // prompt=none request before navigating to the regular login endpoint.
    disableSilentAuth();
    identityVersion.current += 1;
    window.location.assign(`/api/auth/login?next=${encodeURIComponent(nextPath)}`);
  }, []);

  const logout = useCallback(async () => {
    // Explicit logout must not immediately sign the same IdP session back in.
    disableSilentAuth();
    identityVersion.current += 1;
    await fetch('/api/auth/logout', { method: 'POST' });
    useSessionStore.getState().clearAccountAvatar();
    setUser(null);
  }, []);

  const saveAlias = useCallback(
    async (alias: string) => {
      if (!user) throw new Error('AUTH_REQUIRED');
      const version = ++identityVersion.current;
      const response = await fetch('/api/auth/alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      if (!response.ok)
        throw new Error(response.status === 401 ? 'AUTH_REQUIRED' : 'ALIAS_SAVE_FAILED');
      const { user: next } = (await response.json()) as { user: AuthUser };
      if (version !== identityVersion.current) return;
      if (next.id !== user.id) throw new Error('AUTH_REQUIRED');
      rememberIdentity(next);
      setUser(next);
    },
    [user],
  );

  return { user, loading, login, logout, refresh, saveAlias };
}

const AuthIdentityContext = createContext<ReturnType<typeof useAuthIdentityState> | null>(null);

/** A single identity lifecycle shared by the home UI and flag evaluation. */
export function AuthIdentityProvider({ children }: { children: ReactNode }) {
  const identity = useAuthIdentityState();
  return createElement(AuthIdentityContext.Provider, { value: identity }, children);
}

export function useAuthIdentity() {
  const identity = useContext(AuthIdentityContext);
  if (!identity) throw new Error('AuthIdentityProvider is required');
  return identity;
}
