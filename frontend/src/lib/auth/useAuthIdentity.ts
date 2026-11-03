import { disconnectRoom } from '@/lib/socket/client/socket';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { useRoomStore } from '@/lib/store/room';
import { createContext,createElement,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { initialRetryDelay,refreshDecision,SESSION_UNAVAILABLE,sessionReadFromResponse,type SessionRead } from './sessionRead';
import type { AuthUser } from './types';

export type { AuthUser } from './types';

const SILENT_AUTH_TIMEOUT_MS = 6_000;
let silentAuthDisabled =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('authError');
let silentAuthPromise: Promise<AuthUser | null> | null = null;
let cancelSilentAuthAttempt: (() => void) | null = null;

/** Never rejects: a network error is `unavailable`, not a sign-out. */
function readAuthSession(): Promise<SessionRead> {
  return fetch('/api/auth/session', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).then(sessionReadFromResponse, () => SESSION_UNAVAILABLE);
}

function attemptSilentAuth(): Promise<AuthUser | null> {
  if (silentAuthDisabled) return Promise.resolve(null);
  if (silentAuthPromise) return silentAuthPromise;

  const attempt = new Promise<AuthUser | null>((resolve) => {
    const frame = document.createElement('iframe');
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      cancelSilentAuthAttempt = null;
      const read = await readAuthSession();
      frame.remove();
      // Renewal only follows a confirmed sign-out, which stands if the server cannot confirm otherwise.
      resolve(read.kind === 'known' ? read.user : null);
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
  silentAuthPromise = attempt;
  // Coalesce concurrent callers only; a session that lapses later renews with a new attempt.
  void attempt.finally(() => {
    if (silentAuthPromise === attempt) silentAuthPromise = null;
  });
  return attempt;
}

function disableSilentAuth(): void {
  silentAuthDisabled = true;
  cancelSilentAuthAttempt?.();
}

/**
 * Read the local Avalon session, then make one best-effort `prompt=none` OIDC
 * attempt in a hidden iframe. A signed-in session that reaches its fixed expiry is
 * renewed the same way. Failure leaves the user signed out and never navigates the
 * visible page away from the current route.
 *
 * Only a confirmed answer (200 `{ user }` or 401) changes the account. While the
 * server is unavailable (network error, 5xx during a restart or deploy), `refresh()`
 * keeps the current account and skips renewal. Initial load has no account to keep:
 * it shows the signed-out UI, so sign-in stays usable, and re-reads the session with
 * backoff until the server answers.
 */
function useAuthIdentityState() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const identityVersion = useRef(0);
  const currentUser = useRef<AuthUser | null>(null);

  useEffect(() => {
    currentUser.current = user;
  }, [user]);

  const refresh = useCallback(async () => {
    const version = ++identityVersion.current;
    const preferenceRevision = useAccountPreferencesStore.getState().revision;
    const decision = refreshDecision(await readAuthSession(), currentUser.current !== null);
    // A restarting server says nothing about the session; keep the account and its room.
    if (decision.action === 'keep') return currentUser.current;
    // Renew through the identity-provider session before treating a lapsed session as sign-out.
    const next = decision.action === 'renew' ? await attemptSilentAuth() : decision.user;
    if (version !== identityVersion.current) return next;
    useAccountPreferencesStore.getState().hydrate(next, preferenceRevision);
    setUser(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    const version = identityVersion.current;
    // Remove the retired anonymous targeting identifier from existing browsers.
    try { window.localStorage.removeItem('avalon-anonymous-id'); } catch { /* storage may be disabled */ }

    // Any refresh, login or logout bumps the version and takes over from this load.
    const load = (attempt: number) => {
      const preferenceRevision = useAccountPreferencesStore.getState().revision;
      void readAuthSession().then((read) => {
        if (!active || version !== identityVersion.current) return;
        setLoading(false);
        if (read.kind === 'unavailable') {
          // Silent renewal needs the server too; wait for a real answer instead.
          retryTimer = window.setTimeout(() => load(attempt + 1), initialRetryDelay(attempt));
          return;
        }
        const existing = read.user;
        useAccountPreferencesStore.getState().hydrate(existing, preferenceRevision);
        setUser(existing);
        if (existing) return;
        void attemptSilentAuth().then((discovered) => {
          if (!active || !discovered || version !== identityVersion.current) return;
          useAccountPreferencesStore.getState().hydrate(discovered);
          setUser(discovered);
        });
      });
    };
    load(0);

    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    // Also runs on account changes and unmount; do not retain a previous account's socket or roles.
    return () => {
      disconnectRoom();
      useRoomStore.getState().reset();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const dayMs = 24 * 60 * 60 * 1000;
    // Claim when an online account crosses 04:00 UTC+8, including a resumed tab.
    const delay = dayMs - ((Date.now() + 4 * 60 * 60 * 1000) % dayMs) + 100;
    const timer = window.setTimeout(onVisible, delay);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, refresh]);

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
    useAccountPreferencesStore.getState().hydrate(null);
    await fetch('/api/auth/logout', { method: 'POST' });
    disconnectRoom();
    useRoomStore.getState().reset();
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
      setUser(next);
    },
    [user],
  );

  return { user, loading, login, logout, refresh, saveAlias };
}

const AuthIdentityContext = createContext<ReturnType<typeof useAuthIdentityState> | null>(null);

/** A single account lifecycle shared by the home UI and protected routes. */
export function AuthIdentityProvider({ children }: { children: ReactNode }) {
  const identity = useAuthIdentityState();
  return createElement(AuthIdentityContext.Provider, { value: identity }, children);
}

export function useAuthIdentity() {
  const identity = useContext(AuthIdentityContext);
  if (!identity) throw new Error('AuthIdentityProvider is required');
  return identity;
}
