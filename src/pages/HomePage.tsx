import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { PreferencesButton } from '@/components/PreferencesButton';
import { AccountLogin } from '@/components/auth/AccountLogin';
import { HeroCards } from '@/components/home/HeroCards';
import { PublicRooms } from '@/components/home/PublicRooms';
import { RoomCodeInput } from '@/components/home/RoomCodeInput';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { accountDisplayName } from '@/lib/auth/types';
import { useSessionStore } from '@/lib/store/session';
import './home.css';

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();
  const location = useLocation();
  const { user: authUser, loading: authLoading, login, logout } = useAuthIdentity();
  const canJoin = !authLoading && Boolean(authUser);
  const isLocalhost = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('authError');
    if (!code) return;

    const translationKey =
      code === 'denied'
        ? 'home.authDenied'
        : code === 'login_required'
          ? 'home.authLoginRequired'
          : code === 'unavailable'
            ? 'home.authUnavailable'
            : code === 'invalid_flow'
              ? 'home.authInvalidFlow'
              : 'home.authFailed';
    setAuthError(t(translationKey));

    params.delete('authError');
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
    );
  }, [location.hash, location.pathname, location.search, t]);

  const handleCreate = useCallback(async () => {
    if (!authUser) {
      setError(t('home.signInRequiredToCreate'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
        };
        if (res.status === 401 || body.code === 'CREATE_ROOM_TOKEN_REQUIRED') {
          await logout();
          setError(t('home.signInRequiredToCreate'));
          return;
        }
        throw new Error(body.error ?? t('home.errCreateFailed'));
      }
      const { code, hostToken, playerId, playerToken } = (await res.json()) as {
        code: string;
        hostToken: string;
        playerId: string;
        playerToken: string;
      };
      useSessionStore.getState().setSession(code, {
        hostToken,
        playerId,
        playerToken,
        name: accountDisplayName(authUser),
      });
      router.push(`/room/${code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [authUser, logout, router, t]);

  async function handleJoin() {
    if (!canJoin) return setError(t('home.identityRequiredToJoin'));
    const code = joinCode.trim();
    if (!/^[0-9]{4}$/.test(code)) return setError(t('home.errInvalidCode'));
    setJoining(true);
    setError(null);
    try {
      // Catch a mistyped code here; any other failure is left for the lobby to report.
      const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
      if (res.status === 404) return setError(t('common.roomNotFound'));
    } catch {
      // Offline or restarting: the lobby shows its own reconnecting state.
    } finally {
      setJoining(false);
    }
    router.push(`/room/${code}`);
  }

  return (
    // Clip sideways only: cards sliding out past the fan must not widen a phone screen.
    <div className="flex min-h-[100dvh] flex-col overflow-x-clip">
      <header className="mx-auto flex w-full max-w-5xl justify-end gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
        {authUser && (
          <Link href="/history" className="prefs-chip">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="prefs-chip-icon" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4.5a2.5 2.5 0 0 0 2.6 3.5M17 6h2.5a2.5 2.5 0 0 1-2.6 3.5" />
            </svg>
            <span>{t('history.title')}</span>
          </Link>
        )}
        <PreferencesButton variant="chip" />
      </header>

      <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-6">
        <section aria-labelledby="home-title" className="pt-3 text-center sm:pt-[6vh]">
          <HeroCards />
          <h1 id="home-title" className="gilt mt-6 text-[2.75rem] leading-none tracking-[0.14em] sm:text-6xl">
            {t('common.appName')}
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-parchment/60 sm:text-base">
            {t('common.tagline')}
          </p>
        </section>

        {authUser ? (
          <>
            <section aria-label={t('home.createRoom')} className="mt-9 space-y-5">
              <Button
                type="button"
                onClick={() => void handleCreate()}
                className="h-14 w-full rounded-xl text-base tracking-wide"
                disabled={busy || authLoading}
                aria-busy={busy}
              >
                {busy ? (
                  <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                    <path d="M10 4v12M4 10h12" />
                  </svg>
                )}
                {busy ? t('home.creating') : t('home.createRoom')}
              </Button>

              <p className="divider text-xs tracking-wide">
                <span className="text-parchment/45">{t('home.orJoinWithCode')}</span>
              </p>

              <form
                id="join-room-form"
                aria-label={t('home.joinRoom')}
                hidden={!canJoin}
                noValidate
                className="flex gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!joining) void handleJoin();
                }}
              >
                <RoomCodeInput
                  value={joinCode}
                  onChange={(value) => {
                    setJoinCode(value);
                    setError(null);
                  }}
                  disabled={!canJoin}
                  label={t('home.roomCode')}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="submit"
                  disabled={!canJoin || joining}
                  aria-busy={joining}
                  variant="secondary"
                  className="h-14 min-w-[4.75rem] shrink-0 rounded-xl px-5 text-[15px]"
                >
                  {joining ? (
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : null}
                  <span className={joining ? 'sr-only' : undefined}>{t('publicRooms.join')}</span>
                </Button>
              </form>

              {(error || authError) && (
                <p role="alert" className="text-center text-sm text-crimson-bright">{error ?? authError}</p>
              )}
            </section>

            <div className="mt-12">
              <PublicRooms />
            </div>
          </>
        ) : (
          <section aria-label={t('home.signIn')} className="mx-auto mt-9 w-full max-w-sm">
            <AccountLogin
              loading={authLoading}
              error={authError}
              onLogin={() => {
                setAuthError(null);
                login(location.pathname);
              }}
            />
            <p className="mt-4 text-center text-xs leading-relaxed text-parchment/45">{t('home.signInHint')}</p>
          </section>
        )}

        {import.meta.env.DEV && isLocalhost && (
          <p className="mt-auto pt-12 text-center">
            <Link href="/debug/gallery" className="text-xs text-parchment/40 underline decoration-gold/30 underline-offset-4 hover:text-gold">
              {t('debug.entry')}
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
