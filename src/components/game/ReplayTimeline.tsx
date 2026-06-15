'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ReplayData, ReplayRound } from '@/lib/game/replayTypes';

export function ReplayTimeline({ replay }: { replay: ReplayData }) {
  const t = useTranslations();
  const nameOf = (id: string) => {
    const p = replay.players.find((x) => x.id === id);
    return p ? seatLabel(p.seat, p.name) : '???';
  };
  const ladyByRound = new Map(replay.ladyChecks.map((l) => [l.roundIndex, l]));

  return (
    <div className="space-y-3">
      {replay.rounds
        .slice()
        .sort((a, b) => a.roundIndex - b.roundIndex)
        .map((r) => (
          <RoundCard
            key={r.roundIndex}
            round={r}
            nameOf={nameOf}
            lady={ladyByRound.get(r.roundIndex)}
            t={t}
          />
        ))}
    </div>
  );
}

function RoundCard({
  round,
  nameOf,
  lady,
  t,
}: {
  round: ReplayRound;
  nameOf: (id: string) => string;
  lady: ReplayData['ladyChecks'][number] | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  const team = round.finalTeam ?? [];
  const played = round.missionSuccess !== null;

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg text-gold">
          {t('replay.round', { n: round.roundIndex + 1 })}
        </h3>
        {played && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              round.missionSuccess ? 'bg-sky-600/40 text-sky-200' : 'bg-crimson/50 text-parchment'
            }`}
          >
            {round.missionSuccess ? t('replay.missionSuccess') : t('replay.missionFail')}
            {round.failCount !== null && round.failCount > 0
              ? ` · ${t('replay.failCount', { count: round.failCount })}`
              : ''}
          </span>
        )}
      </div>

      <p className="text-sm text-parchment/70">
        {t('replay.leader')}: <span className="text-parchment">{nameOf(round.leaderPlayerId)}</span>
      </p>

      {team.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-parchment/50">{t('replay.team')}:</span>
          {team.map((id) => (
            <span
              key={id}
              className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs text-parchment"
            >
              {nameOf(id)}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-amber-300">{t('replay.noApprovedTeam')}</p>
      )}

      {/* Votes on the final proposal. */}
      {round.votes.length > 0 && (
        <VoteRow votes={round.votes} nameOf={nameOf} t={t} />
      )}

      {/* Mission cards (post-game only). */}
      {played && round.missionCards.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-gold/10 pt-2">
          <span className="text-xs text-parchment/50">{t('replay.missionCards')}:</span>
          {round.missionCards.map((c) => (
            <span
              key={c.playerId}
              className={`rounded px-1.5 py-0.5 text-xs ${
                c.card === 'fail' ? 'bg-crimson/45 text-parchment' : 'bg-sky-600/30 text-sky-200'
              }`}
            >
              {nameOf(c.playerId)}: {c.card === 'fail' ? t('replay.playedFail') : t('replay.playedSuccess')}
            </span>
          ))}
        </div>
      )}

      {/* Lady of the Lake inspection after this round. */}
      {lady && (
        <p className="border-t border-gold/10 pt-2 text-xs text-parchment/70">
          🌊{' '}
          {t('replay.ladyResult', {
            holder: nameOf(lady.holderPlayerId),
            target: nameOf(lady.targetPlayerId),
            team: lady.revealedTeam === 'evil' ? t('mvp.evil') : t('mvp.good'),
          })}
        </p>
      )}
    </Card>
  );
}

function VoteRow({
  votes,
  nameOf,
  t,
}: {
  votes: ReplayData['rounds'][number]['votes'];
  nameOf: (id: string) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  // Show only the final proposal's votes (highest proposalIndex).
  const maxIdx = votes.reduce((m, v) => Math.max(m, v.proposalIndex), 0);
  const finalVotes = votes.filter((v) => v.proposalIndex === maxIdx);

  return (
    <div className="flex flex-wrap gap-1.5 border-t border-gold/10 pt-2">
      <span className="text-xs text-parchment/50">{t('replay.votes')}:</span>
      {finalVotes.map((v) => (
        <span key={v.playerId} className="text-xs text-parchment/80">
          {nameOf(v.playerId)} {v.value === 'approve' ? '👍' : '👎'}
        </span>
      ))}
    </div>
  );
}
