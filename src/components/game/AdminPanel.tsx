'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { useRoomStore } from '@/lib/store/room';
import { adminActions } from '@/lib/socket/client';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

type RefereeTool =
  | 'enable'
  | 'rerollLeader'
  | 'rerollRoles'
  | 'assassination'
  | 'previous'
  | 'skipSpeech'
  | 'pauseTimer'
  | 'resumeTimer'
  | 'unbind'
  | 'vote'
  | 'retractVotes'
  | 'retractProposal'
  | 'propose'
  | 'disable';

/** Independent referee entries in the functions sheet, each with its own dialog. */
export function AdminPanel({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const authed = useRoomStore((state) => state.isReferee);
  const [activeTool, setActiveTool] = useState<RefereeTool | null>(null);
  const [skipTarget, setSkipTarget] = useState<string | null>(null);
  const speakerId = game.phase === 'Discussion' ? game.discussion?.order[game.discussion.speakerIndex] : undefined;
  const speaker = game.players.find((p) => p.id === speakerId);
  const timersPaused = game.actionTimers?.some((timer) => timer.pausedAt !== undefined) ?? false;
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setActiveTool(null);
    setError(null);
    setVoteTarget('');
    setProposeSel([]);
  }, [game.phase, game.phaseRevision, speakerId, authed]);

  // Act-as-player target selection.
  const [voteTarget, setVoteTarget] = useState('');
  const [proposeSel, setProposeSel] = useState<string[]>([]);

  const players = game.players;
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;

  // Admin can only cast a vote for players who haven't voted yet.
  const unvotedPlayers = players.filter(
    (p) => !game.votes?.find((v) => v.playerId === p.id)?.hasVoted,
  );

  const canStartAssassination = !['Assassination', 'GameOver', 'Lobby'].includes(game.phase);
  const entries: {
    id: RefereeTool;
    title: string;
    icon: string;
    disabled?: boolean;
  }[] = authed
    ? [
        ...(game.actionTimers?.length ? [{
          id: timersPaused ? 'resumeTimer' as const : 'pauseTimer' as const,
          title: t(timersPaused ? 'admin.resumeTimer' : 'admin.pauseTimer'),
          icon: timersPaused ? '▶' : 'Ⅱ',
        }] : []),
        ...(speaker ? [{ id: 'skipSpeech' as const, title: t('admin.skipSpeech', { name: seatLabel(speaker.seat, speaker.name) }), icon: '↪' }] : []),
        ...(game.canRerollOpening
          ? [
              { id: 'rerollLeader' as const, title: t('admin.rerollLeader'), icon: '♛' },
              { id: 'rerollRoles' as const, title: t('admin.rerollRoles'), icon: '↻' },
            ]
          : []),
        ...(canStartAssassination
          ? [
              {
                id: 'assassination' as const,
                title: t('admin.startAssassination'),
                icon: '⚔',
              },
            ]
          : []),
        {
          id: 'previous',
          title: t('admin.previousPhase'),
          icon: '↶',
          disabled: !game.previousPhase,
        },
        { id: 'unbind', title: t('admin.unbindTitle'), icon: '♙' },
        ...(game.phase === 'Voting'
          ? [
              { id: 'vote' as const, title: t('admin.voteTitle'), icon: '☑' },
              {
                id: 'retractVotes' as const,
                title: t('admin.retractVotesTitle'),
                icon: '↶',
              },
              {
                id: 'retractProposal' as const,
                title: t('admin.retractProposalTitle'),
                icon: '↶',
              },
            ]
          : []),
        ...((game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing')
          ? [
              {
                id: 'propose' as const,
                title: t('admin.proposeTitle'),
                icon: '♛',
              },
            ]
          : []),
        { id: 'disable', title: t('admin.close'), icon: '✕' },
      ]
    : [{ id: 'enable', title: t('admin.open'), icon: '🛠' }];
  const selectedEntry = entries.find((entry) => entry.id === activeTool && !entry.disabled &&
    (entry.id !== 'skipSpeech' || skipTarget === speakerId));

  async function run(
    fn: () => Promise<{
      ok: boolean;
      error?: { code?: string; message: string };
    }>,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        setActiveTool(null);
      } else {
        setError(res.error?.message ?? t('admin.actionFailed'));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t('admin.actionFailed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleAuth() {
    await run(async () => {
      const res = await adminActions.auth();
      return { ...res, ok: res.ok && !!res.data?.ok };
    });
  }

  async function handleDisable() {
    await run(async () => {
      const res = await adminActions.close();
      return res;
    });
  }

  function toggleProposeMember(id: string) {
    setProposeSel((sel) =>
      sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < teamSize ? [...sel, id] : sel,
    );
  }

  return (
    <>
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          disabled={busy || entry.disabled}
          onClick={() => {
            if (entry.id === 'pauseTimer' || entry.id === 'resumeTimer') {
              void run(() => adminActions.setTimersPaused(entry.id === 'pauseTimer'));
              return;
            }
            setError(null);
            setVoteTarget('');
            setProposeSel([]);
            setSkipTarget(speakerId ?? null);
            setActiveTool(entry.id);
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-crimson/30 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson/60 hover:bg-crimson/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span
            aria-hidden="true"
            className="flex w-8 shrink-0 justify-center text-2xl text-crimson"
          >
            {entry.icon}
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-parchment">{entry.title}</span>
          {authed && entry.id !== 'disable' && (
            <span className="shrink-0 text-xs text-crimson">{t('admin.badge')}</span>
          )}
          <span aria-hidden="true" className="text-parchment/40">
            ›
          </span>
        </button>
      ))}
      {error && !selectedEntry && <p role="alert" className="rounded-lg border border-crimson/50 bg-crimson/20 px-3 py-2 text-sm text-parchment">{error}</p>}
      {selectedEntry &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
            <div
              className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-crimson/40 bg-ink-deep p-4 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label={selectedEntry.title}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg text-crimson">{selectedEntry.title}</h2>
                <button
                  disabled={busy}
                  onClick={() => setActiveTool(null)}
                  className="text-parchment/50 hover:text-parchment"
                  aria-label={t('mission.close')}
                >
                  ✕
                </button>
              </div>

              {error && (
                <div className="rounded-lg border border-crimson/50 bg-crimson/20 px-3 py-2 text-sm text-parchment">
                  {error}
                </div>
              )}

              {activeTool === 'enable' ? (
                <div className="space-y-3">
                  <p className="text-sm text-parchment/60">{t('admin.enableHint')}</p>
                  <Button
                    variant="danger"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void handleAuth()}
                  >
                    {t('admin.open')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-5">
                  {activeTool === 'skipSpeech' && skipTarget && (
                    <Button variant="danger" className="w-full" disabled={busy || skipTarget !== speakerId}
                      onClick={() => void run(() => adminActions.skipSpeech(skipTarget))}>
                      {t('common.confirm')}
                    </Button>
                  )}
                  {(activeTool === 'rerollLeader' || activeTool === 'rerollRoles') && (
                    <section className="space-y-3">
                      <p className="text-sm text-parchment/70">
                        {t(
                          activeTool === 'rerollLeader'
                            ? 'admin.rerollLeaderHint'
                            : 'admin.rerollRolesHint',
                        )}
                      </p>
                      <p className="text-xs text-parchment/50">{t('admin.openingOnlyHint')}</p>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => setActiveTool(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          variant="danger"
                          className="flex-1"
                          disabled={busy || !game.canRerollOpening}
                          onClick={() =>
                            void run(() =>
                              activeTool === 'rerollLeader'
                                ? adminActions.rerollLeader()
                                : adminActions.rerollRoles(),
                            )
                          }
                        >
                          {t('common.confirm')}
                        </Button>
                      </div>
                    </section>
                  )}
                  {(activeTool === 'assassination' || activeTool === 'previous') && (
                    <section className="space-y-3">
                      <p className="text-sm text-parchment/70">
                        {t(
                          activeTool === 'previous'
                            ? 'admin.previousPhaseHint'
                            : 'admin.startAssassinationHint',
                        )}
                      </p>
                      {activeTool === 'previous' && game.previousPhase && (
                        <p className="text-sm text-gold">{t(`phase.${game.previousPhase}`)}</p>
                      )}
                      <Button
                        variant="danger"
                        className="w-full"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            activeTool === 'previous'
                              ? adminActions.previousPhase()
                              : adminActions.startAssassination(),
                          )
                        }
                      >
                        {t('common.confirm')}
                      </Button>
                    </section>
                  )}
                  {activeTool === 'unbind' && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-gold">{t('admin.unbindTitle')}</h3>
                      <p className="text-xs text-parchment/50">{t('admin.unbindHint')}</p>
                      <div className="space-y-1.5">
                        {players.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded-md border border-gold/15 bg-ink/30 px-3 py-1.5 text-sm"
                          >
                            <span className="text-parchment/85">
                              {seatLabel(p.seat, p.name)}
                              <span
                                className={p.connected ? 'text-emerald-400' : 'text-parchment/40'}
                              >
                                {' '}
                                ●
                              </span>
                            </span>
                            <button
                              disabled={busy}
                              onClick={() => void run(() => adminActions.unbind(p.id))}
                              className="rounded px-2 py-0.5 text-xs text-crimson hover:bg-crimson/30 hover:text-parchment disabled:opacity-50"
                            >
                              {t('admin.unbindBtn')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Vote for a player (Voting phase only). */}
                  {activeTool === 'vote' && game.phase === 'Voting' && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-gold">{t('admin.voteTitle')}</h3>
                      <select
                        value={voteTarget}
                        onChange={(e) => setVoteTarget(e.target.value)}
                        className="w-full rounded-md border border-gold/30 bg-ink/50 px-3 py-2 text-sm text-parchment outline-none focus:border-gold/70"
                      >
                        <option value="">{t('admin.selectPlayer')}</option>
                        {unvotedPlayers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {seatLabel(p.seat, p.name)}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button
                          className="flex-1"
                          disabled={
                            !unvotedPlayers.some((player) => player.id === voteTarget) || busy
                          }
                          onClick={() => void run(() => adminActions.vote(voteTarget, 'approve'))}
                        >
                          👍 {t('vote.approve')}
                        </Button>
                        <Button
                          variant="danger"
                          className="flex-1"
                          disabled={
                            !unvotedPlayers.some((player) => player.id === voteTarget) || busy
                          }
                          onClick={() => void run(() => adminActions.vote(voteTarget, 'reject'))}
                        >
                          👎 {t('vote.reject')}
                        </Button>
                      </div>
                    </section>
                  )}

                  {activeTool === 'retractVotes' && game.phase === 'Voting' && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-gold">
                        {t('admin.retractVotesTitle')}
                      </h3>
                      <p className="text-xs text-parchment/50">{t('admin.retractVotesHint')}</p>
                      <Button
                        variant="secondary"
                        className="w-full"
                        disabled={busy}
                        onClick={() => void run(() => adminActions.retractVotes())}
                      >
                        {t('admin.retractVotesBtn')}
                      </Button>
                    </section>
                  )}

                  {activeTool === 'retractProposal' && game.phase === 'Voting' && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-gold">
                        {t('admin.retractProposalTitle')}
                      </h3>
                      <p className="text-xs text-parchment/50">{t('admin.retractProposalHint')}</p>
                      <Button
                        variant="danger"
                        className="w-full"
                        disabled={busy}
                        onClick={() => void run(() => adminActions.retractProposal())}
                      >
                        {t('admin.retractProposalBtn')}
                      </Button>
                    </section>
                  )}

                  {/* Propose the team for the leader (TeamBuilding only). */}
                  {activeTool === 'propose' && (game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing') && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-gold">{t('admin.proposeTitle')}</h3>
                      <p className="text-xs text-parchment/50">
                        {t('admin.proposeHint', { size: teamSize })}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {players.map((p) => {
                          const sel = proposeSel.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              disabled={busy}
                              onClick={() => toggleProposeMember(p.id)}
                              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                                sel
                                  ? 'border-gold bg-gold/20 text-gold'
                                  : 'border-gold/20 text-parchment/70 hover:border-gold/50'
                              }`}
                            >
                              {seatLabel(p.seat, p.name)}
                            </button>
                          );
                        })}
                      </div>
                      <Button
                        variant="danger"
                        className="w-full"
                        disabled={proposeSel.length !== teamSize || busy}
                        onClick={() =>
                          void run(async () => {
                            const leader = players.find((p) => p.seat === game.leaderIndex);
                            const res = await adminActions.propose(leader?.id ?? '', proposeSel);
                            if (res.ok) setProposeSel([]);
                            return res;
                          })
                        }
                      >
                        {t('admin.proposeBtn', {
                          picked: proposeSel.length,
                          size: teamSize,
                        })}
                      </Button>
                    </section>
                  )}

                  {activeTool === 'disable' && (
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={busy}
                      onClick={() => void handleDisable()}
                    >
                      {t('admin.close')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
