import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import type { ClientGameState } from '@/lib/engine';
import { seatLabel } from '@/lib/game/playerLabel';
import { buildVoteMatrix, type MatrixProposal } from '@/lib/game/voteMatrix';
import { cn } from '@/lib/utils/cn';
import { GameIcon } from './GameArt';

/** Seats across, every nomination down, each mission closed by its seal. */
export function VoteMatrix({ game, myPlayerId, focus }: {
  game: ClientGameState;
  myPlayerId: string | null;
  /** A mission to bring into view; `at` replays the request for the same mission. */
  focus?: { round: number; at: number } | null;
}) {
  const t = useTranslations();
  const root = useRef<HTMLTableElement>(null);
  const players = [...game.players].sort((a, b) => a.seat - b.seat);
  const rounds = buildVoteMatrix(game);

  useLayoutEffect(() => {
    if (!focus) return;
    const group = root.current?.querySelector<HTMLElement>(`tbody[data-round="${focus.round}"]`)
      ?? root.current?.querySelector<HTMLElement>('tbody:last-of-type');
    if (!group) return;
    group.scrollIntoView({ block: 'start' });
    group.dataset.flash = '';
    const timer = setTimeout(() => delete group.dataset.flash, 1400);
    return () => clearTimeout(timer);
  }, [focus]);

  return (
    <table ref={root} className="vote-matrix" style={{ '--seats': players.length } as CSSProperties}>
      <colgroup>
        <col className="vote-matrix-label-col" />
        {players.map((p) => <col key={p.id} />)}
      </colgroup>
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">{t('log.tabVotes')}</span></th>
          {players.map((p) => (
            <th key={p.id} scope="col" className={cn(p.id === myPlayerId && 'is-self')} title={seatLabel(p.seat, p.name)}>
              <PlayerAvatar playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name={seatLabel(p.seat, p.name)}
                empty={p.claimed === false} className="vote-matrix-portrait" />
              <span className="vote-matrix-seat tabular-nums" aria-hidden="true">{p.seat + 1}</span>
            </th>
          ))}
        </tr>
      </thead>
      {rounds.map((round) => {
        const sent = round.proposals.find((p) => p.approved)?.team ?? [];
        return (
          <tbody key={round.roundIndex} data-round={round.roundIndex}>
            <tr className="vote-matrix-mission">
              <th scope="rowgroup" colSpan={players.length + 1}>
                <span className="vote-matrix-mission-name">{t('lobby.missionNumber', { n: round.roundIndex + 1 })}</span>
                <span className="vote-matrix-mission-size tabular-nums" aria-label={t('replay.missionSize', { size: round.size })}>{round.size}</span>
                {round.requiredFails === 2 && (
                  <span className="vote-matrix-shield" role="img" aria-label={t('table.twoFails')} title={t('table.twoFails')}>
                    <svg viewBox="0 0 16 18" aria-hidden="true">
                      <path d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z" />
                    </svg>
                  </span>
                )}
              </th>
            </tr>
            {round.proposals.map((proposal) => (
              <ProposalRow key={proposal.key} proposal={proposal} players={players} myPlayerId={myPlayerId}
                maxRejections={game.config.maxRejections ?? 5} />
            ))}
            {round.result && (
              <tr className="vote-matrix-result" data-result={round.result.success ? 'success' : 'fail'}>
                <th scope="row">
                  <span className="vote-matrix-seal">
                    <GameIcon name={round.result.success ? 'missionSuccess' : 'missionFail'} className="h-full w-full"
                      alt={t(round.result.success ? 'missionResult.succeeds' : 'missionResult.sabotaged')} />
                    {round.result.failCount > 0 && <b className="tabular-nums">{round.result.failCount}</b>}
                  </span>
                </th>
                {players.map((p) => (
                  <td key={p.id} className={cn(p.id === myPlayerId && 'is-self')}>
                    {sent.includes(p.id) && <i className="vote-matrix-sent" aria-hidden="true" />}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        );
      })}
    </table>
  );
}

function ProposalRow({ proposal, players, myPlayerId, maxRejections }: {
  proposal: MatrixProposal;
  players: ClientGameState['players'];
  myPlayerId: string | null;
  maxRejections: number;
}) {
  const t = useTranslations();
  const votes = proposal.votes ? [...proposal.votes.values()] : [];
  const approves = votes.filter((v) => v === 'approve').length;
  return (
    <tr
      className="vote-matrix-proposal"
      data-approved={proposal.approved ?? undefined}
      data-open={proposal.votes ? undefined : ''}
      data-last={proposal.proposalIndex === maxRejections - 1 || undefined}
    >
      <th scope="row" aria-label={[
        t('vote.proposalLabel', { n: proposal.proposalIndex + 1 }),
        proposal.votes && t('vote.tally', { approves, rejects: votes.length - approves }),
      ].filter(Boolean).join(' · ')}>
        <span className="vote-matrix-proposal-n tabular-nums">{proposal.proposalIndex + 1}</span>
        {proposal.votes && <span className="vote-matrix-tally tabular-nums">{approves}:{votes.length - approves}</span>}
      </th>
      {players.map((p) => {
        const vote = proposal.votes?.get(p.id);
        const onTeam = proposal.team.includes(p.id);
        const leads = proposal.leaderId === p.id;
        const label = [
          seatLabel(p.seat, p.name),
          leads && t('table.leader'),
          onTeam && t('vote.teamLabel'),
          vote && t(vote === 'approve' ? 'vote.approve' : 'vote.reject'),
        ].filter(Boolean).join(' · ');
        return (
          <td key={p.id} className={cn(p.id === myPlayerId && 'is-self')}>
            <span className="vote-matrix-cell" data-on-team={onTeam || undefined} role="img" aria-label={label}>
              {vote && <GameIcon name={vote} className="vote-matrix-stone" />}
              {leads && <GameIcon name="leader" className="vote-matrix-crown" />}
            </span>
          </td>
        );
      })}
    </tr>
  );
}
