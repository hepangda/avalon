import { Popconfirm } from '@/components/ui/Popconfirm';
import { Button } from '@/components/ui/Button';
import type { ClientGameState } from '@/lib/engine';
import { bySeat, seatLabel } from '@/lib/game/playerLabel';
import { adminActions } from '@/lib/socket/client';
import { useTranslations } from 'use-intl';
import { TableSheet, useSheetPresence } from './TableSheet';

import type { useRefereeTools } from './useRefereeTools';

/** Referee tools that need players picked; plain yes/no tools ask with a popconfirm on their tile instead. */
export function RefereeToolDialog({ tools, game }: { tools: ReturnType<typeof useRefereeTools>; game: ClientGameState }) {
  const t = useTranslations();
  const { activeTool, setActiveTool, busy, error, voteTarget, setVoteTarget, proposeSel, setProposeSel, players, teamSize, unvotedPlayers, selectedEntry, run, toggleProposeMember } = tools;
  const [present, onExited] = useSheetPresence(!!selectedEntry);
  return <>
    {present && (
      <TableSheet open={!!selectedEntry} title={selectedEntry?.title ?? ''} onClose={() => setActiveTool(null)} onExited={onExited} busy={busy} error={error}>
        <div className="space-y-5">
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
                      <Popconfirm confirmLabel={t('common.confirm')} title={t('admin.ask.unbind', { name: seatLabel(p.seat, p.name) })}
                        disabled={busy} onConfirm={() => run(() => adminActions.unbind(p.id))}>
                        {(trigger) => <button {...trigger} type="button" disabled={busy}
                          className="rounded px-2 py-0.5 text-xs text-crimson hover:bg-crimson/30 hover:text-parchment disabled:opacity-50">
                          {t('admin.unbindBtn')}
                        </button>}
                      </Popconfirm>
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
                  {(['approve', 'reject'] as const).map((value) => (
                    <Popconfirm confirmLabel={t('common.confirm')} key={`${voteTarget}:${value}`}
                      title={t('admin.ask.vote', {
                        name: players.find((p) => p.id === voteTarget)?.name ?? '', vote: t(`vote.${value}`),
                      })}
                      disabled={!unvotedPlayers.some((player) => player.id === voteTarget) || busy}
                      onConfirm={() => run(() => adminActions.vote(voteTarget, value))}>
                      {(trigger) => <Button {...trigger} variant={value === 'reject' ? 'danger' : undefined}
                        className="flex-1" disabled={!unvotedPlayers.some((player) => player.id === voteTarget) || busy}>
                        {value === 'approve' ? '👍' : '👎'} {t(`vote.${value}`)}
                      </Button>}
                    </Popconfirm>
                  ))}
                </div>
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
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${sel
                            ? 'border-gold bg-gold/20 text-gold'
                            : 'border-gold/20 text-parchment/70 hover:border-gold/50'
                          }`}
                      >
                        {seatLabel(p.seat, p.name)}
                      </button>
                    );
                  })}
                </div>
                <Popconfirm confirmLabel={t('common.confirm')} key={proposeSel.join(',')}
                  title={t('admin.ask.propose', { names: bySeat(game, proposeSel).map((id) => {
                    const player = players.find((p) => p.id === id);
                    return player ? seatLabel(player.seat, player.name) : '';
                  }).join(', ') })}
                  disabled={proposeSel.length !== teamSize || busy}
                  onConfirm={() => run(async () => {
                    const leader = players.find((p) => p.seat === game.leaderIndex);
                    const res = await adminActions.propose(leader?.id ?? '', proposeSel);
                    if (res.ok) setProposeSel([]);
                    return res;
                  })}>
                  {(trigger) => <Button {...trigger} variant="danger" className="w-full"
                    disabled={proposeSel.length !== teamSize || busy}>
                    {t('admin.proposeBtn', { picked: proposeSel.length, size: teamSize })}
                  </Button>}
                </Popconfirm>
              </section>
            )}
        </div>
      </TableSheet>
    )}
  </>;
}
