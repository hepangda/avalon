'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ReplayTimeline } from '@/components/game/ReplayTimeline';
import { MvpPanel } from '@/components/game/MvpPanel';
import { ROLE_SIGIL, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { seatLabel } from '@/lib/game/playerLabel';
import { teamOf } from '@/lib/engine';
import type { ReplayData } from '@/lib/game/replayTypes';

export default function ReplayPage() {
  const t = useTranslations();
  const roleText = useRoleText();
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId ?? '';

  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Persistence of the final game state is asynchronous, so a replay opened
      // immediately after GameOver may briefly 409 ("not finished"). Retry a
      // few times before surfacing an error.
      const maxAttempts = 6;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const res = await fetch(`/api/games/${gameId}/replay`);
        if (res.ok) {
          const d = (await res.json()) as ReplayData;
          if (!cancelled) setData(d);
          return;
        }
        if (res.status === 404) {
          if (!cancelled) setError(t('replay.notFound'));
          return;
        }
        if (res.status === 409 && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!cancelled)
          setError(res.status === 409 ? t('replay.notFinished') : (body.error ?? 'Error'));
        return;
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [gameId, t]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-crimson">{error}</p>
        <Link href="/">
          <Button variant="secondary">{t('replay.backHome')}</Button>
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-parchment/60">{t('replay.loading')}</p>
      </main>
    );
  }

  const goodWon = data.outcome?.winner === 'good';
  const nameOf = (id: string) => {
    const p = data.players.find((x) => x.id === id);
    return p ? seatLabel(p.seat, p.name) : '???';
  };

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-gold">{t('replay.title')}</h1>
        <LocaleSwitcher />
      </div>

      {/* Outcome banner */}
      {data.outcome && (
        <Card className="text-center">
          <p className="text-4xl">{goodWon ? '⚜️' : '🗡️'}</p>
          <p className={`font-serif text-2xl ${goodWon ? 'text-sky-300' : 'text-crimson'}`}>
            {t('replay.outcome', {
              winner: goodWon ? t('replay.goodWon') : t('replay.evilWon'),
            })}
          </p>
        </Card>
      )}

      {/* Role reveal */}
      <Card className="space-y-2">
        <h2 className="font-serif text-xl text-gold">{t('replay.roles')}</h2>
        <ul className="grid grid-cols-2 gap-1.5">
          {data.roleAssignments
            .slice()
            .sort((a, b) => {
              const sa = data.players.find((p) => p.id === a.playerId)?.seat ?? 0;
              const sb = data.players.find((p) => p.id === b.playerId)?.seat ?? 0;
              return sa - sb;
            })
            .map((r) => (
              <li
                key={r.playerId}
                className="flex items-center gap-1.5 rounded-lg border border-gold/15 bg-ink/30 px-2 py-1.5 text-sm"
              >
                <span>{ROLE_SIGIL[r.role]}</span>
                <span className="text-parchment">{nameOf(r.playerId)}</span>
                <span className={`ml-auto text-xs ${TEAM_COLOR[teamOf(r.role)]}`}>
                  {roleText.name(r.role)}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      {/* MVP / stats */}
      <MvpPanel replay={data} />

      {/* Round-by-round timeline */}
      <ReplayTimeline replay={data} />

      {/* Assassination */}
      {data.assassination && (
        <Card className="space-y-1 text-center">
          <h2 className="font-serif text-lg text-crimson">{t('replay.assassination')}</h2>
          <p className="text-sm text-parchment/80">
            {t('replay.assassinResult', {
              assassin: nameOf(data.assassination.assassinPlayerId),
              target: nameOf(data.assassination.targetPlayerId),
            })}
          </p>
          <p className={`text-sm ${data.assassination.hitMerlin ? 'text-crimson' : 'text-sky-300'}`}>
            {data.assassination.hitMerlin ? t('replay.hitMerlin') : t('replay.missedMerlin')}
          </p>
        </Card>
      )}

      <Link href="/" className="block">
        <Button className="w-full">{t('replay.backHome')}</Button>
      </Link>
    </main>
  );
}
