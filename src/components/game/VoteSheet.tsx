import type { CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import type { ClientGameState, ClientLogEntry } from '@/lib/engine';
import type { ProposalChapter, QuestItem } from '@/lib/game/foldLog';
import { seatLabel } from '@/lib/game/playerLabel';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { GameIcon } from './GameArt';
import { LogCoin, LogStone, QuestHead, questStanding } from './ProposalRecord';

/**
 * Every nomination as a row of ballots under the seats that cast them, so a
 * player's votes read down their own column; the team sits on a gilt ground.
 */
export function VoteSheet({ quests, game, live, format }: {
  quests: QuestItem[];
  game: ClientGameState;
  /** The quest the table is playing, 1-based. */
  live: number | null;
  format: (entry: ClientLogEntry) => string;
}) {
  const t = useTranslations();
  const seats = [...game.players].sort((a, b) => a.seat - b.seat);
  const style = { '--seats': seats.length } as CSSProperties;
  const row = (chapter: ProposalChapter) => {
    const { record } = chapter;
    const approves = record?.votes.filter((v) => v.vote === 'approve').length ?? 0;
    return (
      <div key={chapter.key} className="vote-sheet-row" role="row" data-verdict={record ? (record.approved ? 'approved' : 'rejected') : 'open'}>
        <span className="vote-sheet-leader" role="rowheader" aria-label={t('vote.proposalLabel', { n: chapter.proposal })}>
          <LogCoin game={game} id={chapter.leader} tone="ring" crowned />
        </span>
        {seats.map((p) => {
          const vote = record?.votes.find((v) => v.playerId === p.id)?.vote;
          return (
            <span key={p.id} role="cell" className="vote-sheet-cell" data-team={chapter.team.includes(p.id) || undefined}
              aria-label={`${seatLabel(p.seat, p.name)}${vote ? `：${t(`vote.${vote}`)}` : ''}`}>
              {vote ? <LogStone game={game} id={p.id} vote={vote} bare /> : <i className="vote-sheet-wait" />}
            </span>
          );
        })}
        <span className="vote-sheet-tally tabular-nums" role="cell">
          {record ? `${approves}:${record.votes.length - approves}` : '…'}
        </span>
      </div>
    );
  };

  return (
    <div className="vote-sheet" style={style} role="table" aria-label={t('log.tabVotes')}>
      <div className="vote-sheet-seats" role="row">
        <span />
        {seats.map((p) => (
          <span key={p.id} className="vote-sheet-seat" role="columnheader" title={seatLabel(p.seat, p.name)}>
            <PlayerAvatar playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name={p.name}
              className="vote-sheet-face" />
            <b className="tabular-nums">{p.seat + 1}</b>
          </span>
        ))}
        <span />
      </div>
      {quests.map((item) => {
        if (item.kind === 'entry') {
          if (!item.entry.key.startsWith('ladyInspected')) return null;
          return (
            <p key={item.entry.seq} className="vote-sheet-note">
              <GameIcon name="lady" className="vote-sheet-note-icon" />
              {format(item.entry)}
            </p>
          );
        }
        const rows = item.body.filter((b): b is ProposalChapter => b.kind === 'proposal' && (!!b.record || b.live));
        const { result, current } = questStanding(game, item.round, live === item.round);
        return (
          <section key={`${item.round}-${item.heading?.seq ?? ''}`} className="vote-sheet-quest log-quest"
            data-result={result ? (result.success ? 'success' : 'fail') : current ? 'live' : undefined}>
            <QuestHead game={game} round={item.round} live={live === item.round} />
            {rows.map(row)}
          </section>
        );
      })}
    </div>
  );
}
