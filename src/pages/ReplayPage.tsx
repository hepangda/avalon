import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ReplayTimeline } from '@/components/game/ReplayTimeline';
import { GameIcon, RolePortrait } from '@/components/game/GameArt';
import { TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { seatLabel } from '@/lib/game/playerLabel';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import { teamOf } from '@/lib/engine';
import type { ReplayData } from '@/lib/game/replayTypes';

export default function ReplayPage() {
  const t = useTranslations();
  const roleText = useRoleText();
  const params = useParams();
  const gameId = params.gameId ?? '';

  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setData(null);
    setError(null);

    async function load() {
      // A durable archive may still be retrying its transfer from the room.
      const maxAttempts = 6;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (cancelled) return;
        const res = await fetch(`/api/games/${gameId}/replay`, {
          signal: controller.signal, cache: 'no-store',
        });
        if (res.ok) {
          const d = (await res.json()) as ReplayData;
          if (!cancelled) setData(d);
          return;
        }
        if ((res.status === 404 || res.status === 409) && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        if (!cancelled)
          setError(t(res.status === 404 ? 'replay.notFound' : res.status === 409 ? 'replay.notFinished' : 'replay.loadFailed'));
        return;
      }
    }

    void load().catch(() => {
      if (!cancelled) setError(t('replay.loadFailed'));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [gameId, t, loadAttempt]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-crimson">{error}</p>
        <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t('replay.retry')}</Button>
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
          <GameIcon
            name={goodWon ? 'crest' : 'reject'}
            className="mx-auto h-16 w-16 drop-shadow-[0_0_16px_rgba(201,162,39,0.28)]"
          />
          <p className="outcome-title font-serif text-2xl" data-winner={data.outcome.winner}>
            {t('replay.outcome', {
              winner: goodWon ? t('replay.goodWon') : t('replay.evilWon'),
            })}
          </p>
          <p className="mt-2 text-sm text-parchment/70">
            {t(`gameOver.${outcomeReasonKey(data.outcome)}`)}
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
                <RolePortrait role={r.role} variant={r.roleVariant} className="h-8 w-8 rounded-full" />
                <span className="text-parchment">{nameOf(r.playerId)}</span>
                <span className={`ml-auto text-xs ${TEAM_COLOR[teamOf(r.role)]}`}>
                  {roleText.shortName(r.role)}
                </span>
              </li>
            ))}
        </ul>
      </Card>

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
          <p
            className={`text-sm ${data.assassination.hitMerlin ? 'text-crimson' : 'text-sky-300'}`}
          >
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
