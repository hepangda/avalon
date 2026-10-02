import { Button } from '@/components/ui/Button';
import type { ClientGameState } from '@/lib/engine';
import { seatLabel } from '@/lib/game/playerLabel';
import { adminActions } from '@/lib/socket/client';
import { useTranslations } from 'use-intl';
import { TableSheet } from './TableSheet';

import type { useRefereeTools } from './useRefereeTools';

export function RefereeToolDialog({ tools, game }: { tools: ReturnType<typeof useRefereeTools>; game: ClientGameState }) {
  const t = useTranslations();
  const { activeTool, setActiveTool, skipTarget, speakerId, busy, error, voteTarget, setVoteTarget, proposeSel, setProposeSel, players, teamSize, unvotedPlayers, selectedEntry, run, handleAuth, handleDisable, toggleProposeMember } = tools;
  return <>
    {selectedEntry && (
      <TableSheet open title={selectedEntry.title} onClose={() => setActiveTool(null)} busy={busy} error={error}>
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
        )}        </TableSheet>
    )}
  </>;
}
