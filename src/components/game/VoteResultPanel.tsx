import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, ClientVoteRecord } from '@/lib/engine';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { GameIcon } from './GameArt';

/** A face from the log, numbered with its seat. */
export function LogFace({ game, id, className = '', children }: {
  game: Pick<ClientGameState, 'players'>; id: string; className?: string; children?: ReactNode;
}) {
  const p = game.players.find((player) => player.id === id);
  if (!p) return null;
  return (
    <PlayerAvatar playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name={p.name}
      className={`log-face ${className}`}>
      <b className="log-face-seat">{p.seat + 1}</b>
      {children}
    </PlayerAvatar>
  );
}

/** One proposal as the table saw it: the leader and team, then every seat's stone. */
export function VoteResultPanel({
  record,
  game,
}: {
  record: ClientVoteRecord;
  game: ClientGameState;
}) {
  const t = useTranslations();
  const nameOf = (id: string) => labelById(game, id);
  const approves = record.votes.filter((v) => v.vote === 'approve').length;
  const rejects = record.votes.length - approves;
  const seatOf = (id: string) => game.players.find((p) => p.id === id)?.seat ?? 0;

  return (
    <div className="vote-record" data-approved={record.approved}>
      <div className="vote-record-head">
        <span className="vote-record-team" aria-label={`${t('vote.proposer')}：${nameOf(record.leaderId)} · ${t('vote.teamLabel')}：${record.team.map(nameOf).join('、')}`}>
          <LogFace game={game} id={record.leaderId} className="is-leader">
            <GameIcon name="leader" className="log-face-crown" />
          </LogFace>
          <svg className="vote-record-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" /></svg>
          {record.team.map((id) => <LogFace key={id} game={game} id={id} className="is-team" />)}
        </span>
        <span className="vote-record-verdict" role="img"
          aria-label={`${record.approved ? t('vote.approved') : t('vote.rejectedResult')} · ${t('vote.tally', { approves, rejects })}`}>
          <GameIcon name="approve" className="vote-record-stone" />{approves}
          <GameIcon name="reject" className="vote-record-stone" />{rejects}
        </span>
      </div>
      <ol className="vote-record-ballots" aria-label={t('vote.votesDetail')}>
        {record.votes
          .slice()
          .sort((a, b) => seatOf(a.playerId) - seatOf(b.playerId))
          .map((v) => (
            <li key={v.playerId} data-vote={v.vote} title={`${nameOf(v.playerId)} · ${t(`vote.${v.vote}`)}`}
              aria-label={`${nameOf(v.playerId)} · ${t(`vote.${v.vote}`)}`}>
              <LogFace game={game} id={v.playerId} className={record.team.includes(v.playerId) ? 'is-team' : ''}>
                <GameIcon name={v.vote} className="vote-record-ballot" />
              </LogFace>
            </li>
          ))}
      </ol>
    </div>
  );
}
