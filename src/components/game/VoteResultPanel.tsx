'use client';

import { useTranslations } from 'next-intl';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, ClientVoteRecord } from '@/lib/engine';

/**
 * Renders one completed proposal's votes: the tally, the team, and each
 * player's approve/reject. Reused by the post-vote reveal and the round-history
 * popover.
 */
export function VoteResultPanel({
  record,
  game,
  compact = false,
  showProposalLabel = false,
}: {
  record: ClientVoteRecord;
  game: ClientGameState;
  compact?: boolean;
  /** Show the "Proposal N" prefix (history view); omit it in the war log where
   *  the surrounding log line already states the proposal number. */
  showProposalLabel?: boolean;
}) {
  const t = useTranslations();
  const nameOf = (id: string) => labelById(game, id);
  const approves = record.votes.filter((v) => v.vote === 'approve').length;
  const rejects = record.votes.length - approves;

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {/* Proposer + result + tally. */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-parchment/70">
          {showProposalLabel && (
            <span className="text-parchment/50">
              {t('vote.proposalLabel', { n: record.proposalIndex + 1 })} ·{' '}
            </span>
          )}
          {t('vote.proposer')}：<span className="text-parchment">{nameOf(record.leaderId)}</span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            record.approved ? 'bg-sky-600/40 text-sky-200' : 'bg-crimson/40 text-crimson'
          }`}
        >
          {record.approved ? t('vote.approved') : t('vote.rejectedResult')} ·{' '}
          {t('vote.tally', { approves, rejects })}
        </span>
      </div>

      {/* Team members. */}
      {record.team.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-1">
          <span className="text-xs text-parchment/50">{t('vote.teamLabel')}：</span>
          {record.team.map((id) => (
            <span
              key={id}
              className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs text-parchment"
            >
              {nameOf(id)}
            </span>
          ))}
        </div>
      )}

      {/* Per-player vote detail. */}
      <div>
        <p className="mb-1 text-xs text-parchment/50">{t('vote.votesDetail')}</p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {record.votes
            .slice()
            .sort((a, b) => {
              const sa = game.players.find((p) => p.id === a.playerId)?.seat ?? 0;
              const sb = game.players.find((p) => p.id === b.playerId)?.seat ?? 0;
              return sa - sb;
            })
            .map((v) => (
              <span
                key={v.playerId}
                className="flex items-center justify-between gap-1 rounded-md border border-gold/10 bg-ink/30 px-2 py-1 text-xs"
              >
                <span className="truncate text-parchment/80">{nameOf(v.playerId)}</span>
                <span
                  className={`shrink-0 font-medium ${
                    v.vote === 'approve' ? 'text-sky-300' : 'text-crimson-bright'
                  }`}
                >
                  {v.vote === 'approve' ? t('vote.approve') : t('vote.reject')}
                </span>
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
