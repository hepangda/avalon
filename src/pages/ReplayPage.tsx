import { useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFormatter, useTranslations } from 'use-intl';
import { Link } from '@/i18n/navigation';
import { PreferencesButton } from '@/components/PreferencesButton';
import { GameIcon, type GameIconName } from '@/components/game/GameArt';
import { ReplayChronicle, scrollWithin } from '@/components/replay/ReplayChronicle';
import { ReplayLedger, TwoFailShield } from '@/components/replay/ReplayLedger';
import { ReplayPlayerSheet } from '@/components/replay/ReplayPlayerSheet';
import { buildReplayModel, type ReplayModel } from '@/lib/game/replayModel';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import type { ReplayData } from '@/lib/game/replayTypes';
import '@/styles/replay.css';

type View = 'ledger' | 'chronicle';
const VIEWS: View[] = ['ledger', 'chronicle'];

export default function ReplayPage() {
  const t = useTranslations();
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
      const res = await fetch(`/api/games/${gameId}/replay`, {
        signal: controller.signal, cache: 'no-store',
      });
      if (cancelled) return;
      if (!res.ok) {
        setError(t(res.status === 404 ? 'replay.notFound' : 'replay.loadFailed'));
        return;
      }
      const replay = await res.json() as ReplayData;
      if (!cancelled) setData(replay);
    }

    void load().catch(() => {
      if (!cancelled) setError(t('replay.loadFailed'));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [gameId, t, loadAttempt]);

  const model = useMemo(() => (data ? buildReplayModel(data) : null), [data]);

  return (
    <main className="table-screen replay-screen">
      <header className="table-header">
        <Link href="/" className="table-brand" aria-label={t('replay.backHome')}>
          <span aria-hidden="true">←</span>
          <span>AVALON</span>
          <span className="text-parchment/35">·</span>
          <span className="text-parchment/80">{t('replay.title')}</span>
        </Link>
        <PreferencesButton />
      </header>
      {model ? (
        <ReplayBoard model={model} />
      ) : (
        <div className="replay-status">
          {error ? (
            <>
              <p className="text-crimson-bright">{error}</p>
              <button type="button" className="table-action" onClick={() => setLoadAttempt((n) => n + 1)}>
                {t('replay.retry')}
              </button>
            </>
          ) : (
            <p className="animate-pulse text-parchment/60">{t('replay.loading')}</p>
          )}
        </div>
      )}
    </main>
  );
}

function verdictIcon(model: ReplayModel): GameIconName {
  switch (model.outcome?.reason) {
    case 'assassinated_merlin':
      return 'assassinate';
    case 'five_rejections':
    case 'rejection_limit':
      return 'reject';
    case 'three_missions':
      return model.outcome.winner === 'good' ? 'missionSuccess' : 'missionFail';
    default:
      return 'crest';
  }
}

function ReplayBoard({ model }: { model: ReplayModel }) {
  const t = useTranslations();
  const format = useFormatter();
  const tabsId = useId();
  const [view, setView] = useState<View>('ledger');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusPlayer, setFocusPlayer] = useState<string | null>(null);
  const [sheetPlayer, setSheetPlayer] = useState<string | null>(null);
  const outcome = model.outcome;

  const openPlayer = (id: string) => {
    setFocusPlayer(id);
    setSheetPlayer(id);
  };
  // Choosing the same event again still scrolls back to it.
  const [focusNonce, setFocusNonce] = useState(0);
  const focusEvent = (key: string, switchView: boolean) => {
    setFocusKey(key);
    setFocusNonce((n) => n + 1);
    if (switchView) setView('chronicle');
  };

  useEffect(() => {
    const container = document.querySelector<HTMLElement>('.replay-ledger-scroll');
    if (!focusKey?.startsWith('m') || !container) return;
    const header = container.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    scrollWithin(container, container.querySelector(`tbody[data-round="${focusKey.slice(1)}"]`), header);
  }, [focusKey, focusNonce]);

  const minutes = model.startedAt && model.endedAt
    ? Math.max(1, Math.round((model.endedAt - model.startedAt) / 60_000))
    : null;
  const meta = [
    model.startedAt && format.dateTime(new Date(model.startedAt), {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    minutes && t('replay.duration', { minutes }),
    t('replay.playerCount', { count: model.players.length }),
    t('replay.proposalCount', { count: model.proposalCount }),
    model.maxRejections !== 5 && t('replay.rejectionLimit', { count: model.maxRejections }),
  ].filter(Boolean);

  return (
    <>
      <section className="replay-verdict" data-winner={outcome?.winner}>
        <div className="replay-verdict-title">
          <GameIcon name={verdictIcon(model)} className="replay-verdict-icon" />
          <div className="min-w-0">
            {outcome && (
              <h1 className="outcome-title font-serif" data-winner={outcome.winner}>
                {t(outcome.winner === 'good' ? 'replay.goodWon' : 'replay.evilWon')}
              </h1>
            )}
            {outcome && <p className="replay-verdict-reason">{t(`gameOver.${outcomeReasonKey(outcome)}`)}</p>}
            <p className="replay-verdict-meta">
              {meta.map((item, i) => <span key={i}>{item}</span>)}
            </p>
          </div>
        </div>
        <ol className="replay-track" aria-label={t('mission.track')}>
          {model.missions.map((mission) => {
            const reached = mission.proposals.length > 0;
            return (
              <li key={mission.roundIndex}>
                <button
                  type="button"
                  className="replay-track-quest"
                  data-result={mission.success === null ? undefined : mission.success ? 'success' : 'fail'}
                  disabled={!reached}
                  aria-current={focusKey === `m${mission.roundIndex}` ? 'true' : undefined}
                  aria-label={[
                    t('replay.mission', { n: mission.roundIndex + 1 }),
                    t('replay.missionSize', { size: mission.size }),
                    mission.success === null
                      ? t(reached ? 'replay.noTeamApproved' : 'replay.notPlayed')
                      : t(mission.success ? 'replay.missionSuccess' : 'replay.missionFail'),
                  ].join(' · ')}
                  onClick={() => focusEvent(`m${mission.roundIndex}`, false)}
                >
                  {mission.success !== null && (
                    <GameIcon
                      name={mission.success ? 'missionSuccess' : 'missionFail'}
                      className="replay-track-art"
                    />
                  )}
                  <span className="replay-track-size tabular-nums">{mission.size}</span>
                  {mission.requiredFails === 2 && <TwoFailShield label={t('table.twoFails')} />}
                  {!!mission.failCount && (
                    <span className="replay-track-fails" aria-hidden="true">
                      {Array.from({ length: mission.failCount }, (_, i) => <i key={i} />)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div role="tablist" aria-label={t('replay.views')} className="replay-tabs">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`${tabsId}-tab-${v}`}
            aria-controls={`${tabsId}-${v}`}
            aria-selected={view === v}
            tabIndex={view === v ? 0 : -1}
            className="replay-tab"
            onClick={() => setView(v)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const next = v === 'ledger' ? 'chronicle' : 'ledger';
              setView(next);
              document.getElementById(`${tabsId}-tab-${next}`)?.focus();
            }}
          >
            {t(`replay.${v}`)}
          </button>
        ))}
      </div>

      <div className="replay-workspace" data-view={view}>
        <section
          className="replay-pane replay-pane--ledger"
          id={`${tabsId}-ledger`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-ledger`}
        >
          <h2 className="replay-pane-title">{t('replay.ledger')}</h2>
          <ReplayLedger
            model={model}
            focusPlayer={focusPlayer}
            focusKey={focusKey}
            onSelectPlayer={openPlayer}
            onSelectEvent={(key) => focusEvent(key, true)}
          />
        </section>
        <section
          className="replay-pane replay-pane--chronicle"
          id={`${tabsId}-chronicle`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-chronicle`}
        >
          <h2 className="replay-pane-title">{t('replay.chronicle')}</h2>
          <ReplayChronicle
            model={model}
            focusKey={focusKey}
            focusNonce={focusNonce}
            onSelectPlayer={openPlayer}
          />
        </section>
      </div>

      <ReplayPlayerSheet
        model={model}
        playerId={sheetPlayer}
        onSelectPlayer={openPlayer}
        onClose={() => setSheetPlayer(null)}
      />
    </>
  );
}
