import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '@/lib/store/session';

const SILENT_AUTH_TIMEOUT_MS = 6_000;
let silentAuthDisabled = false;
let silentAuthPromise: Promise<AuthUser | null> | null = null;
let cancelSilentAuthAttempt: (() => void) | null = null;

export interface AuthUser {
  id: string;
  username: string;
  picture?: string;
}

async function readAuthUser(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/session', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return ((await response.json()) as { user: AuthUser | null }).user;
}

function rememberIdentity(user: AuthUser | null): void {
  if (user) useSessionStore.getState().setAccountIdentity(user.username, user.picture);
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
 * visible page away from the home screen.
 */
export function useAuthIdentity() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await readAuthUser().catch(() => null);
    rememberIdentity(next);
    setUser(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;

    void readAuthUser()
      .catch(() => null)
      .then((existing) => {
        if (!active) return;
        rememberIdentity(existing);
        setUser(existing);
        setLoading(false);
        if (existing) return;
        void attemptSilentAuth().then((discovered) => {
          if (!active || !discovered) return;
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
    window.location.assign(`/api/auth/login?next=${encodeURIComponent(nextPath)}`);
  }, []);

  const logout = useCallback(async () => {
    // Explicit logout must not immediately sign the same IdP session back in.
    disableSilentAuth();
    await fetch('/api/auth/logout', { method: 'POST' });
    useSessionStore.getState().clearAccountAvatar();
    setUser(null);
  }, []);

  return { user, loading, login, logout, refresh };
}
