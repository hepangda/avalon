'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { adminActions } from '@/lib/socket/client';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

/**
 * Referee (admin) panel. Anyone may open it mid-game to handle out-of-band
 * situations: unbind a disconnected player so the seat can be re-claimed, cast a
 * vote for someone, or propose the team for a stuck leader. There is no
 * password — opening requires only a confirmation tap.
 *
 * Authorization is per-socket and lives only in this component's local state
 * (a refresh clears it). Every action the server performs is announced in the
 * public war-log in red, so the whole table can audit who did what.
 *
 * Security: the operator never assumes a target's identity — all "act as"
 * actions are performed server-side, so no private role/vision leaks here.
 */
export function AdminPanel({
  game,
  open,
  onClose,
}: {
  game: ClientGameState;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Act-as-player target selection.
  const [voteTarget, setVoteTarget] = useState('');
  const [proposeSel, setProposeSel] = useState<string[]>([]);

  const players = game.players;
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;

  // Admin can only cast a vote for players who haven't voted yet.
  const unvotedPlayers = players.filter(
    (p) => !game.votes?.find((v) => v.playerId === p.id)?.hasVoted,
  );

  async function handleAuth() {
    setError(null);
    setBusy(true);
    const res = await adminActions.auth();
    setBusy(false);
    if (res.ok && res.data?.ok) {
      setAuthed(true);
    } else {
      setError(res.error?.message ?? t('admin.enableFailed'));
    }
  }

  async function handleClose() {
    await adminActions.close();
    setAuthed(false);
    onClose();
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok && res.error) setError(res.error.message);
  }

  function toggleProposeMember(id: string) {
    setProposeSel((sel) =>
      sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < teamSize ? [...sel, id] : sel,
    );
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-crimson/40 bg-ink-deep p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg text-crimson">🛠 {t('admin.title')}</h2>
          <button
            onClick={onClose}
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

            {!authed ? (
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
                {/* Unbind a player. */}
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
                          <span className={p.connected ? 'text-emerald-400' : 'text-parchment/40'}>
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

                {/* Vote for a player (Voting phase only). */}
                {game.phase === 'Voting' && (
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
                        disabled={!voteTarget || busy}
                        onClick={() => void run(() => adminActions.vote(voteTarget, 'approve'))}
                      >
                        👍 {t('vote.approve')}
                      </Button>
                      <Button
                        variant="danger"
                        className="flex-1"
                        disabled={!voteTarget || busy}
                        onClick={() => void run(() => adminActions.vote(voteTarget, 'reject'))}
                      >
                        👎 {t('vote.reject')}
                      </Button>
                    </div>
                  </section>
                )}

                {/* Retract votes / proposal (Voting phase only). */}
                {game.phase === 'Voting' && (
                  <>
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
                  </>
                )}

                {/* Propose the team for the leader (TeamBuilding only). */}
                {game.phase === 'TeamBuilding' && (
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
                      {t('admin.proposeBtn', { picked: proposeSel.length, size: teamSize })}
                    </Button>
                  </section>
                )}

                <button
                  onClick={() => void handleClose()}
                  className="w-full rounded-md border border-gold/20 px-3 py-2 text-sm text-parchment/60 hover:text-parchment"
                >
                  {t('admin.close')}
                </button>
              </div>
            )}
          </div>
        </div>,
    document.body,
  );
}
