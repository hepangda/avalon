import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { useSessionStore } from '@/lib/store/session';

const DEFAULT_SEAT_COUNT = 5;

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();

  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? t('home.errCreateFailed'));
      }
      const { code, hostToken } = (await res.json()) as { code: string; hostToken: string };
      useSessionStore.getState().setSession(code, { hostToken });
      router.push(`/room/${code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          <div className="mb-2 animate-flicker text-4xl">⚜️</div>
          <h1 className="gilt text-4xl tracking-wide sm:text-5xl">{t('common.appName')}</h1>
          <p className="mt-2 text-sm text-parchment/55">{t('common.tagline')}</p>
        </header>

        <Card className="space-y-4 p-4 sm:p-5">
          <Button
            className="h-14 w-full text-base sm:text-lg"
            onClick={handleCreate}
            disabled={busy}
          >
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
            <Button
              variant="secondary"
              className="h-11 min-w-20 shrink-0 whitespace-nowrap px-5"
              onClick={handleJoin}
            >
              {t('home.join')}
            </Button>
          </div>

          {error && <p className="text-center text-sm text-crimson">{error}</p>}
        </Card>
      </section>
    </main>
  );
}