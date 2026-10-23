import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useFormatter, useTranslations } from 'use-intl';
import { Link } from '@/i18n/navigation';
import { GameTable } from '@/components/game/GameTable';
import { MissionToken } from '@/components/game/MissionTrack';
import { TableCard } from '@/components/game/TableCard';
import { TableFrame } from '@/components/game/TableFrame';
import { ReplayBoard } from '@/components/replay/ReplayBoard';
import { ReplayLog } from '@/components/replay/ReplayLog';
import { ReplayTimeline } from '@/components/replay/ReplayTimeline';
import { useStepLabel } from '@/components/replay/stepText';
import { PreferencesButton } from '@/components/PreferencesButton';
import type { ClientPlayer } from '@/lib/engine';
import { buildReplayModel, type ReplayModel } from '@/lib/game/replayModel';
import { replaySteps, viewpointNotes, type ReplayStep } from '@/lib/game/replaySteps';
import type { ReplayView } from '@/lib/game/replayTypes';
import type { EndingMark } from '@/lib/game/tablePresentation';
import '@/styles/replay.css';

const BEAT_MS = 2400;

function BackLink() {
  const t = useTranslations();
  return (
    <Link href="/history" className="table-tool -ml-2.5 shrink-0" aria-label={t('history.title')} title={t('history.title')}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 5-7 7 7 7M5 12h14" />
      </svg>
    </Link>
  );
}

export default function ReplayPage() {
  const t = useTranslations();
  const gameId = useParams().gameId ?? '';
  const [view, setView] = useState<ReplayView | null>(null);
  const [error, setError] = useState<'notFound' | 'loadFailed' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError(null);
    fetch(`/api/games/${encodeURIComponent(gameId)}/replay`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'notFound' : 'loadFailed');
        setView(await res.json() as ReplayView);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message === 'notFound' ? 'notFound' : 'loadFailed');
      });
    return () => controller.abort();
  }, [gameId, attempt]);

  const model = useMemo(() => (view ? buildReplayModel(view.replay) : null), [view]);
  if (model) return <ReplayTable model={model} viewerId={view!.viewerId} />;
  return (
    <main className="table-screen">
      <header className="table-header">
        <div className="table-title">
          <BackLink />
          <span className="table-title-name">{t('replay.title')}</span>
        </div>
        <PreferencesButton />
      </header>
      <div className="replay-status" role={error ? 'alert' : 'status'}>
        {error ? (
          <>
            <p>{t(`replay.${error}`)}</p>
            {error === 'loadFailed' && (
              <button type="button" className="table-action is-quiet" onClick={() => setAttempt((n) => n + 1)}>
                {t('replay.retry')}
              </button>
            )}
          </>
        ) : (
          <p className="animate-pulse">{t('replay.loading')}</p>
        )}
      </div>
    </main>
  );
}

function ReplayTable({ model, viewerId }: { model: ReplayModel; viewerId: string | null }) {
  const t = useTranslations();
  const format = useFormatter();
  const label = useStepLabel();
  const steps = useMemo(() => replaySteps(model), [model]);
  const [params, setParams] = useSearchParams();
  const index = Math.min(steps.length - 1, Math.max(0, steps.findIndex((s) => s.key === params.get('step'))));
  const step = steps[index]!;
  const [playing, setPlaying] = useState(false);
  // From above, every card is open; from one seat, only what that seat could see.
  const [viewpoint, setViewpoint] = useState<string | null>(null);

  const seek = useCallback((next: number) => {
    const target = steps[Math.min(steps.length - 1, Math.max(0, next))]!;
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set('step', target.key);
      return updated;
    }, { replace: true });
  }, [steps, setParams]);
  const stop = (next: number) => {
    setPlaying(false);
    seek(next);
  };

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => seek(index + 1), BEAT_MS);
    return () => clearTimeout(timer);
  }, [playing, index, steps.length, seek]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const moves: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: steps.length - 1 };
      if (event.key in moves) {
        event.preventDefault();
        setPlaying(false);
        seek(moves[event.key]!);
      } else if (event.key === ' ' && !(event.target as HTMLElement | null)?.closest('button, a')) {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, steps.length, seek]);

  const players: ClientPlayer[] = model.players.map((p) => ({
    id: p.id, name: p.name, seat: p.seat, avatarUrl: p.avatarUrl, isBot: p.isBot,
    connected: true, claimed: true,
    isLeader: step.kind !== 'end' && step.leaderId === p.id,
    isLadyHolder: step.ladyId === p.id,
  }));
  const notes = viewpointNotes(model, step.kind === 'end' ? null : viewpoint);
  const marks = endMarks(model);
  const card = (p: ClientPlayer) => seatCard(model, step, p.id, viewpoint, marks);
  const highlight = step.kind === 'vote' ? step.proposal.team ?? []
    : step.kind === 'quest' ? step.mission.team ?? []
    : step.kind === 'lady' ? [step.check.targetPlayerId]
    : step.kind === 'strike' ? [step.assassination.targetPlayerId]
    : [];
  const firstStepOf = (roundIndex: number) => steps.findIndex((s) => s.roundIndex === roundIndex && s.kind === 'vote');
  const watcher = viewpoint ? model.byId.get(viewpoint) : undefined;

  return (
    <div className="replay-screen">
      <TableFrame
        title={model.startedAt ? format.dateTime(new Date(model.startedAt), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('replay.title')}
        headerStart={<BackLink />}
        headerAction={() => (
          <button type="button" className="replay-viewpoint" data-active={watcher ? '' : undefined}
            aria-label={watcher ? t('replay.viewpointOf', { seat: watcher.seat + 1, name: watcher.name }) : t('replay.allSeen')}
            onClick={() => setViewpoint(null)} disabled={!watcher}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" /><circle cx="10" cy="10" r="2.4" /></svg>
            <span>{watcher ? `${watcher.seat + 1}. ${watcher.name}` : t('replay.allSeen')}</span>
            {watcher && <span aria-hidden="true">×</span>}
          </button>
        )}
        progress={
          <>
            <div className="table-status">
              <span className="table-status-label" aria-live="polite">{label(step)}</span>
              <span className="table-status-detail tabular-nums">{index + 1} / {steps.length}</span>
            </div>
            <ol className="table-missions" aria-label={t('mission.track')}>
              {model.missions.map((mission) => {
                const settled = mission.roundIndex < step.settled && mission.success !== null;
                const first = firstStepOf(mission.roundIndex);
                return (
                  <li key={mission.roundIndex}>
                    <button type="button" disabled={first < 0}
                      className={`table-mission${settled ? (mission.success ? ' is-success' : ' is-fail') : step.roundIndex === mission.roundIndex && step.kind !== 'end' ? ' is-current' : ''}`}
                      aria-label={t('replay.mission', { n: mission.roundIndex + 1 })}
                      onClick={() => stop(first)}>
                      <MissionToken size={mission.size} needsTwo={mission.requiredFails === 2}
                        seal={settled ? (mission.success ? 'missionSuccess' : 'missionFail') : undefined}
                        fails={settled && !mission.success ? mission.failCount ?? undefined : undefined} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        }
        footer={
          <ReplayTimeline steps={steps} index={index} playing={playing}
            onSeek={stop}
            onTogglePlay={() => {
              if (!playing && index >= steps.length - 1) seek(0);
              setPlaying((value) => !value);
            }} />
        }
        tools={(viewToggle) => viewToggle}
        report={(showTable) => <ReplayLog model={model} steps={steps} index={index} onSeek={(i) => { stop(i); showTable(); }} />}
      >
        <GameTable
          players={players}
          myPlayerId={viewerId}
          board={<ReplayBoard key={step.key} model={model} step={step} viewpoint={viewpoint} />}
          card={card}
          highlightIds={highlight}
          selectable
          selectedIds={viewpoint ? [viewpoint] : []}
          onToggle={(id) => setViewpoint((current) => (current === id ? null : id))}
          dimNonCandidates={false}
          showNotes
          roleNotes={notes}
          knownNotes={notes}
        />
      </TableFrame>
    </div>
  );
}

/** How the assassination left each card at the end, as the live table marks it. */
function endMarks(model: ReplayModel): Record<string, EndingMark> {
  const strike = model.assassination;
  if (!strike) return {};
  const hit = strike.hitMerlin;
  const marks: Record<string, EndingMark> = {
    [strike.targetPlayerId]: hit ? 'slain' : 'spared',
    [strike.assassinPlayerId]: hit ? 'killer' : 'foiled',
  };
  const merlin = model.players.find((p) => p.role === 'Merlin');
  if (!hit && merlin && !marks[merlin.id]) marks[merlin.id] = 'survivor';
  return marks;
}

/** The card in front of a seat at one beat; a viewpoint keeps hidden cards face down. */
function seatCard(model: ReplayModel, step: ReplayStep, id: string, viewpoint: string | null,
  marks: Record<string, EndingMark>) {
  const p = model.byId.get(id)!;
  const sees = !viewpoint || viewpoint === id;
  switch (step.kind) {
    case 'deal':
      return sees && p.role ? <TableCard role={p.role} variant={p.variant} /> : <TableCard state="back" />;
    case 'vote': {
      const vote = step.proposal.votes.get(id);
      return vote ? <TableCard state={vote} revealId={step.key} /> : <TableCard state="inactive" />;
    }
    case 'quest': {
      const played = step.mission.cards.get(id);
      if (!played) return <TableCard state={step.mission.team?.includes(id) ? 'back' : 'inactive'} />;
      // Quest cards are anonymous at the table: one seat only ever saw its own.
      return <TableCard state={sees ? played : 'back'} revealId={step.key} />;
    }
    case 'strike':
      return [step.assassination.targetPlayerId, step.assassination.assassinPlayerId].includes(id) && p.role
        ? <TableCard role={p.role} variant={p.variant} faceDown={false} mark={marks[id]} />
        : <TableCard state="inactive" />;
    case 'end':
      return p.role
        ? <TableCard role={p.role} variant={p.variant} faceDown={false} mark={marks[id]} lost={p.team !== model.outcome?.winner} />
        : <TableCard state="inactive" />;
    default:
      return <TableCard state="inactive" />;
  }
}
