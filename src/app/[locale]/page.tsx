'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { useSessionStore } from '@/lib/store/session';

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();

  // Host-defined roster: start with 5 blank seats (min playable).
  const [roster, setRoster] = useState<string[]>(() => ['', '', '', '', '']);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setSeat(i: number, value: string) {
    setRoster((r) => r.map((n, idx) => (idx === i ? value : n)));
  }
  function addSeat() {
    setRoster((r) => (r.length >= 10 ? r : [...r, '']));
  }
  function removeSeat(i: number) {
    setRoster((r) => (r.length <= 1 ? r : r.filter((_, idx) => idx !== i)));
  }

  async function handleCreate() {
    // Blank seats become "玩家 X" / "Player X" (1-based seat number).
    const names = roster.map((n, i) => n.trim() || t('home.defaultSeatName', { n: i + 1 }));
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>

      <header className="text-center">
        <div className="mb-2 animate-flicker text-4xl">⚜️</div>
        <h1 className="gilt text-5xl tracking-wide">{t('common.appName')}</h1>
        <p className="mt-2 text-sm text-parchment/60">{t('common.tagline')}</p>
      </header>

      <Card className="w-full max-w-sm space-y-5">
        {/* Roster builder */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-parchment/60">
            {t('home.rosterLabel')}
          </label>
          <div className="space-y-1.5">
            {roster.map((name, i) => (
              <div key={i} className="flex gap-1.5">
                <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded-md bg-gold/15 text-xs text-gold">
                  {i + 1}
                </span>
                <Input
                  value={name}
                  onChange={(e) => setSeat(i, e.target.value)}
                  placeholder={t('home.seatPlaceholder', { n: i + 1 })}
                  maxLength={24}
                  autoComplete="off"
                />
                {roster.length > 1 && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs text-crimson"
                    onClick={() => removeSeat(i)}
                    title={t('home.removeSeat')}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
          </div>
          {roster.length < 10 && (
            <Button variant="secondary" className="w-full text-sm" onClick={addSeat}>
              {t('home.addSeat')}
            </Button>
          )}
          <p className="text-xs text-parchment/40">{t('home.rosterHint')}</p>
        </div>

        <Button className="w-full" onClick={handleCreate} disabled={busy}>
          {busy ? t('home.creating') : t('home.createRoom')}
        </Button>

        <div className="divider text-xs">{t('home.or')}</div>

        <div className="flex gap-2">
          <Input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder={t('home.roomCode')}
            maxLength={6}
            className="uppercase tracking-widest"
            autoComplete="off"
          />
          <Button variant="secondary" onClick={handleJoin}>
            {t('home.join')}
          </Button>
        </div>

        {error && <p className="text-center text-sm text-crimson">{error}</p>}
      </Card>
    </main>
  );
}
