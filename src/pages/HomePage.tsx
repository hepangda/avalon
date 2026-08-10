import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { GameIcon } from '@/components/game/GameArt';
import { IdentityPanel } from '@/components/home/IdentityPanel';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { useSessionStore } from '@/lib/store/session';

const DEFAULT_SEAT_COUNT = 5;

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();
  const location = useLocation();
  const { user: authUser, loading: authLoading, login, logout } = useAuthIdentity();

  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error(
          body.code === 'VOICE_UNAVAILABLE' ? t('home.errVoiceUnavailable') : (body.error ?? t('home.errCreateFailed')),
        );
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
        name: authUser.username,
      });
      router.push(`/room/${code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [authUser, logout, router, t]);

  function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return setError(t('home.errInvalidCode'));
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
          user={authUser}
          loading={authLoading}
          onLogin={() => login(location.pathname)}
          onLogout={logout}
        />

        <Card className="space-y-4 p-4 sm:p-5">
          <p className="font-serif text-sm font-semibold text-gold">{t('home.roomActionsTitle')}</p>

          <Button className="h-14 w-full text-base sm:text-lg" onClick={handleCreate} disabled={busy || authLoading}>
            {busy ? t('home.creating') : t('home.createRoom')}
          </Button>

          <div className="divider text-xs">{t('home.or')}</div>

          <div className="flex gap-2">
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoin();
              }}
              placeholder={t('home.roomCode')}
              maxLength={6}
              className="h-11 min-w-0 uppercase tracking-widest"
              autoComplete="off"
            />
            <Button variant="secondary" className="h-11 min-w-20 shrink-0 whitespace-nowrap px-5" onClick={handleJoin}>
              {t('home.join')}
            </Button>
          </div>

          {error && <p className="text-center text-sm text-crimson">{error}</p>}
        </Card>
      </section>
    </main>
  );
}
