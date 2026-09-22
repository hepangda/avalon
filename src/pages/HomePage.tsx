import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { GameIcon } from '@/components/game/GameArt';
import { IdentityPanel } from '@/components/home/IdentityPanel';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { accountDisplayName } from '@/lib/auth/types';
import { useSessionStore } from '@/lib/store/session';

const DEFAULT_SEAT_COUNT = 5;

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();
  const location = useLocation();
  const { user: authUser, loading: authLoading, login, logout, saveAlias } = useAuthIdentity();
  const identityName = useSessionStore((state) => state.lastName);
  const canJoin = !authLoading && Boolean(authUser || identityName.trim());
  const isLocalhost = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  const [joinCode, setJoinCode] = useState('');
  const [joinExpanded, setJoinExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
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
    const names = Array.from({ length: DEFAULT_SEAT_COUNT }, (_, i) =>
      t('home.defaultSeatName', { n: i + 1 }),
    );
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster: names }),
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

  function handleJoin() {
    if (!canJoin) return setError(t('home.identityRequiredToJoin'));
    const code = joinCode.trim();
    if (!/^[0-9]{4}$/.test(code)) return setError(t('home.errInvalidCode'));
    router.push(`/room/${code}`);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <div className="absolute right-4 top-4 z-10">
        <LocaleSwitcher />
      </div>

      <section className="w-full max-w-md space-y-5">
        <header className="text-center">
          <GameIcon
            name="crest"
            className="mx-auto mb-1 h-16 w-16 animate-flicker drop-shadow-[0_0_16px_rgba(201,162,39,0.35)]"
          />
          <h1 className="gilt text-4xl tracking-wide sm:text-5xl">{t('common.appName')}</h1>
          <p className="mt-2 text-sm text-parchment/55">{t('common.tagline')}</p>
        </header>

        <IdentityPanel
          key={authUser?.id ?? 'anonymous'}
          user={authUser}
          loading={authLoading}
          authError={authError}
          onLogin={() => {
            setAuthError(null);
            login(location.pathname);
          }}
          onLogout={logout}
          onSaveAlias={saveAlias}
        />

        <Card className="space-y-4 p-4 sm:p-5">
          <p className="font-serif text-sm font-semibold text-gold">{t('home.roomActionsTitle')}</p>

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <Button type="submit" className="h-14 w-full text-base sm:text-lg" disabled={busy || authLoading || !authUser}>
              {busy ? t('home.creating') : t('home.createRoom')}
            </Button>
            {!authUser && <p className="text-xs text-parchment/45">{t('home.signInRequiredToCreate')}</p>}
          </form>

          <div className="divider text-xs">{t('home.or')}</div>

          <button
            type="button"
            className="flex w-full items-center justify-between text-sm text-gold disabled:cursor-not-allowed disabled:text-parchment/45"
            aria-expanded={canJoin && joinExpanded}
            aria-controls="join-room-form"
            disabled={!canJoin}
            onClick={() => setJoinExpanded((expanded) => !expanded)}
          >
            {t('home.joinRoom')}
            <span aria-hidden="true">{canJoin && joinExpanded ? '−' : '+'}</span>
          </button>
          {!canJoin && <p className="text-xs text-parchment/45">{t('home.identityRequiredToJoin')}</p>}
          <form
            id="join-room-form"
            hidden={!canJoin || !joinExpanded}
            onSubmit={(event) => {
              event.preventDefault();
              handleJoin();
            }}
          >
            <div className="flex gap-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
                disabled={!canJoin}
                aria-label={t('home.roomCode')}
                placeholder={t('home.roomCode')}
                maxLength={4}
                inputMode="numeric"
                pattern="[0-9]{4}"
                className="h-11 min-w-0 tracking-widest"
                autoComplete="off"
              />
              <Button type="submit" disabled={!canJoin} variant="secondary" className="h-11 min-w-20 shrink-0 whitespace-nowrap px-5">
                {t('home.join')}
              </Button>
            </div>
          </form>

          {error && <p className="text-center text-sm text-crimson">{error}</p>}
        </Card>
        {isLocalhost && (
          <p className="text-center">
            <Link href="/debug/gallery" className="text-xs text-parchment/45 underline decoration-gold/30 underline-offset-4 hover:text-gold">
              {t('debug.entry')}
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
