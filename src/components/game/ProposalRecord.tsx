import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { labelById, seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState, ClientLogEntry, ClientMissionResult, ClientVoteRecord } from '@/lib/engine';
import type { ProposalChapter } from '@/lib/game/foldLog';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { GameIcon } from './GameArt';

/**
 * A player as the log names them: the seat number first, since that is how the
 * table refers to people. A chip adds the face (and the name when `named`);
 * a coin is the number alone, for long rows of voters and speakers.
 */
export function LogSeat({ game, id, coin = false, named = false, className = '', children }: {
  game: Pick<ClientGameState, 'players'>; id: string; coin?: boolean; named?: boolean; className?: string; children?: ReactNode;
}) {
  const p = game.players.find((player) => player.id === id);
  if (!p) return null;
  if (coin) return <span className={`log-coin tabular-nums ${className}`} title={seatLabel(p.seat, p.name)}>{p.seat + 1}</span>;
  return (
    <span className={`log-seat ${className}`} title={seatLabel(p.seat, p.name)}>
      <PlayerAvatar playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name={p.name}
        className="log-seat-face">
        {children}
      </PlayerAvatar>
      <b className="log-seat-n tabular-nums">{p.seat + 1}</b>
      {named && <span className="log-seat-name">{p.name}</span>}
    </span>
  );
}

/**
 * One nomination as a single card: who led and whom they sent, how the table
 * voted (approvals and rejections on their own rows), and the quest it produced.
 */
export function ProposalRecord({
  chapter,
  game,
  record,
  mission,
  limit,
  leader,
  status,
  format,
  clock,
}: {
  chapter: ProposalChapter;
  game: ClientGameState;
  record?: ClientVoteRecord;
  mission?: ClientMissionResult;
  limit: number;
  leader: string;
  /** What the table is doing now, on the nomination still in play. */
  status: string | null;
  format: (entry: ClientLogEntry) => string;
  clock: (at: number) => string;
}) {
  const t = useTranslations();
  const nameOf = (id: string) => labelById(game, id);
  const seatOf = (id: string) => game.players.find((p) => p.id === id)?.seat ?? 0;
  const team = record?.team ?? chapter.team;
  const ballots = (record?.votes ?? []).slice().sort((a, b) => seatOf(a.playerId) - seatOf(b.playerId));
  const sides = (['approve', 'reject'] as const).map((vote) => ({
    vote,
    ids: ballots.filter((b) => b.vote === vote).map((b) => b.playerId),
  }));
  const [approves, rejects] = sides.map((s) => s.ids.length) as [number, number];
  const verdict = record ? (record.approved ? 'approved' : 'rejected') : 'open';
  const speakers = chapter.speeches.filter((e) => e.key === 'speechBegins');

  return (
    <article className="proposal-record" data-verdict={verdict} data-last={chapter.proposal >= limit || undefined}
      data-live={status ? true : undefined}>
      <header className="proposal-record-head">
        <span className="proposal-record-n" title={clock(chapter.vote?.at ?? 0)}>
          {t('log.proposalOf', { n: chapter.proposal, limit })}
        </span>
        {record ? (
          <span className="proposal-record-verdict" role="img"
            aria-label={`${record.approved ? t('vote.approved') : t('vote.rejectedResult')} · ${t('vote.tally', { approves, rejects })}`}>
            {record.approved ? t('vote.approved') : t('vote.rejectedResult')}
            <span className="proposal-record-tally tabular-nums" aria-hidden="true">{approves}<i>:</i>{rejects}</span>
          </span>
        ) : status && !mission ? (
          <span className="proposal-record-status">{status}</span>
        ) : null}
      </header>

      <div className="proposal-record-row" aria-label={`${t('log.label.leader')}：${nameOf(leader)}`}>
        <span className="proposal-record-label" aria-hidden="true">{t('log.label.leader')}</span>
        <LogSeat game={game} id={leader} named className="is-leader" />
      </div>
      {team.length > 0 && (
        <div className="proposal-record-row" aria-label={`${t('log.label.team')}：${team.map(nameOf).join('、')}`}>
          <span className="proposal-record-label" aria-hidden="true">{t('log.label.team')}</span>
          {team.map((id) => <LogSeat key={id} game={game} id={id} named className="is-team" />)}
        </div>
      )}
      {chapter.draft && (
        <div className="proposal-record-row" aria-label={`${t('log.label.draft')}：${chapter.draft.map(nameOf).join('、')}`}>
          <span className="proposal-record-label" aria-hidden="true">{t('log.label.draft')}</span>
          {chapter.draft.map((id) => (
            <LogSeat key={id} game={game} id={id} coin className={team.includes(id) ? '' : 'is-dropped'} />
          ))}
        </div>
      )}

      {chapter.speeches.length > 0 && (
        <details className="proposal-record-speeches">
          <summary className="proposal-record-row">
            <span className="proposal-record-label">{t('log.label.speeches')}</span>
            <span className="proposal-record-speakers" aria-hidden="true">
              {speakers.map((e, i) => typeof e.params?.player === 'string' && (
                <LogSeat key={`${e.seq}-${i}`} game={game} id={e.params.player} coin />
              ))}
            </span>
          </summary>
          <ol className="proposal-record-speech-lines">
            {chapter.speeches.map((entry) => (
              <li key={entry.seq} data-admin={entry.style === 'admin' || undefined}>
                <span className="tabular-nums">{clock(entry.at)}</span>
                {format(entry)}
              </li>
            ))}
          </ol>
        </details>
      )}

      {record && (
        <div className="proposal-record-ballots" aria-label={t('vote.votesDetail')}>
          {sides.map(({ vote, ids }) => (
            <div key={vote} className="proposal-record-row" data-vote={vote}
              aria-label={`${t(`vote.${vote}`)}：${ids.length ? ids.map(nameOf).join('、') : '—'}`}>
              <span className="proposal-record-label" aria-hidden="true">{t(`log.label.${vote}`)}</span>
              {ids.length ? ids.map((id) => (
                <LogSeat key={id} game={game} id={id} coin className={team.includes(id) ? 'is-team' : ''} />
              )) : <span className="proposal-record-none" aria-hidden="true">—</span>}
            </div>
          ))}
        </div>
      )}

      {chapter.notes.map((entry) => (
        <p key={entry.seq} className="proposal-record-note" title={clock(entry.at)}>{format(entry)}</p>
      ))}

      {mission ? (
        <footer className="proposal-record-quest" data-result={mission.success ? 'success' : 'fail'}>
          <span className="proposal-record-cards" role="img"
            aria-label={`${t('cue.missionCardsTitle')}：${mission.teamSize - mission.failCount} ${t('cue.cardSuccess')} · ${mission.failCount} ${t('cue.cardFail')}`}>
            {Array.from({ length: mission.teamSize }, (_, i) => {
              const fail = i >= mission.teamSize - mission.failCount;
              return (
                <span key={i} className="proposal-record-card" data-fail={fail || undefined}>
                  <GameIcon name={fail ? 'missionFail' : 'missionSuccess'} className="h-full w-full" />
                </span>
              );
            })}
          </span>
          <span className="proposal-record-outcome">{t(mission.success ? 'cue.missionSuccess' : 'cue.missionFail')}</span>
        </footer>
      ) : record?.approved && status ? (
        <footer className="proposal-record-quest" data-result="pending">
          <span className="proposal-record-cards" aria-hidden="true">
            {team.map((id) => <span key={id} className="proposal-record-card" />)}
          </span>
          <span className="proposal-record-outcome">{status}</span>
        </footer>
      ) : null}
    </article>
  );
}
