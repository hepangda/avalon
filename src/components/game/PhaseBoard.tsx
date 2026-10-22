import type { ClientGameState } from '@/lib/engine';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import type { TablePresentation } from '@/lib/game/tablePresentation';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { TableCard } from './TableCard';
import { GameIcon } from './GameArt';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';

export function PhaseBoard({ game, presentation, isOver, isLeader, isHolder, isAssassin, canVote, canMission, selected, round, teamSize }: {
  game: ClientGameState; presentation: TablePresentation | null;
  isOver: boolean; isLeader: boolean; isHolder: boolean; isAssassin: boolean; canVote: boolean; canMission: boolean;
  selected: string[]; round: number; teamSize: number;
}) {
  const t = useTranslations();
  const team = game.proposedTeam ?? [];
  const leader = game.players.find((p) => p.seat === game.leaderIndex);
  const speakerId = game.phase === 'Discussion' ? game.discussion?.order[game.discussion.speakerIndex] : undefined;
  const speaker = game.players.find((p) => p.id === speakerId);
  /** The team as portraits on the felt; open places show how many are still to be named. */
  function chips(ids: string[], size = ids.length, tone: 'gold' | 'sky' | 'crimson' = 'gold') {
    return (
      <ol className="table-team-chips" data-tone={tone} aria-label={t('table.teamSlots', { count: ids.length, total: size })}>
        {Array.from({ length: Math.max(size, ids.length) }, (_, index) => {
          const p = game.players.find((player) => player.id === ids[index]);
          return p ? (
            <li key={p.id} className="table-team-chip" data-player-id={p.id} title={`${p.seat + 1}. ${p.name}`}>
              <PlayerAvatar playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name={p.name} className="table-team-avatar">
                <b className="table-team-seat">{p.seat + 1}</b>
              </PlayerAvatar>
              <span className="table-team-name">{p.name}</span>
            </li>
          ) : (
            <li key={`open-${index}`} className="table-team-chip is-open" aria-hidden="true">
              <span className="table-team-avatar" />
              <span className="table-team-name" />
            </li>
          );
        })}
      </ol>
    );
  }
  // The title keeps one place on the felt in every phase; whatever follows hangs beneath it.
  const layout = (title: ReactNode, body?: ReactNode) => (
    <>
      <div className="table-board-title">{title}</div>
      <div className="table-board-body">{body}</div>
    </>
  );
  if (presentation?.kind === 'mission' || presentation?.kind === 'assassination') return null;
  if (presentation?.kind === 'vote')
    return layout(
      <h2 className="table-phase-title">
        {t(presentation.record.approved ? 'cue.voteApproved' : 'cue.voteRejected')}
      </h2>,
      <>
        {chips(presentation.record.team)}
        <p className="table-phase-detail">
          {t('vote.tally', {
            approves: presentation.record.votes.filter((v) => v.vote === 'approve').length,
            rejects: presentation.record.votes.filter((v) => v.vote === 'reject').length,
          })}
        </p>
      </>,
    );
  if (isOver)
    return layout(
      <h1 className="table-phase-title outcome-title" data-winner={game.outcome?.winner}>
        {t(game.outcome?.winner === 'good' ? 'gameOver.goodTriumphs' : 'gameOver.evilPrevails')}
      </h1>,
      game.outcome && <p className="table-phase-detail">{t(`gameOver.${outcomeReasonKey(game.outcome)}`)}</p>,
    );
  if (game.phase === 'TeamAnnouncement' || game.phase === 'Discussion')
    return layout(
      <h2 className="table-phase-title" aria-live="polite">
        {game.phase === 'TeamAnnouncement' ? t('discussion.announced') : t('discussion.speaking', {
          name: speaker ? `${speaker.seat + 1}. ${speaker.name}` : '',
        })}
      </h2>,
      <>
        {chips(team)}
        {game.phase === 'Discussion' && (
          <div className="discussion-turn">
            <p className="table-phase-detail">{t('discussion.speechProgress', {
              current: (game.discussion?.speakerIndex ?? 0) + 1, total: game.players.length,
            })}</p>
            <ol className="discussion-order" aria-label={t('discussion.order')}>
              {game.discussion?.order.map((id, index) => {
                const player = game.players.find((p) => p.id === id)!;
                return <li key={id} aria-current={id === speakerId ? 'step' : undefined}
                  data-done={index < game.discussion!.speakerIndex} title={player.name}>
                  {player.seat + 1}
                </li>;
              })}
            </ol>
          </div>
        )}
      </>,
    );
  if (game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing')
    return layout(
      <h2 className="table-phase-title">
        {game.phase === 'TeamFinalizing' ? t('discussion.finalizing') : isLeader
          ? t('teamBuilder.youLead')
          : t('teamBuilder.leaderChoosing', { name: leader ? `${leader.seat + 1}. ${leader.name}` : '' })}
      </h2>,
      chips(isLeader ? selected : game.phase === 'TeamFinalizing' ? team : [], teamSize),
    );
  if (game.phase === 'Voting')
    return layout(
      <h2 className={`table-phase-title${game.teamChanged ? ' is-team-changed' : ''}`} aria-live="polite">
        {t(game.teamChanged ? 'discussion.teamChanged' : canVote ? 'table.voteQuestion' : 'table.waitingVotes')}
      </h2>,
      chips(team),
    );
  if (game.phase === 'MissionVote')
    return layout(
      <h2 className="table-phase-title" aria-live="polite">
        {t(canMission ? 'table.missionPrompt' : 'table.waitingMissionCards')}
      </h2>,
      <>
        {chips(team, team.length, 'sky')}
        {game.config.requiredFails[round] === 2 && <p className="table-phase-detail">{t('table.twoFails')}</p>}
      </>,
    );
  if (game.phase === 'LadyOfLake')
    return layout(
      <h2 className="table-phase-title">
        {isHolder
          ? t('lady.title')
          : t('lady.gazingWaters', { name: game.players.find((p) => p.id === game.lady?.holderId)?.name ?? '' })}
      </h2>,
      <div className="table-lady-pool">
        <GameIcon name="lady" className="table-lady-emblem" />
        {isHolder && chips(selected, 1, 'sky')}
      </div>,
    );
  if (game.phase === 'Assassination')
    return layout(
      <h2 className="table-phase-title">{t('assassin.title')}</h2>,
      <>
        <div className="table-public-roles" aria-label={t('assassin.identitiesPublic')}>
          {game.players
            .filter((p) => p.role && ROLE_TEAM_UI[p.role] === 'evil')
            .map((p) => (
              <div className="table-public-role" key={p.id}>
                <TableCard role={p.role} />
                <span>{p.seat + 1}. {p.name}</span>
              </div>
            ))}
        </div>
        {isAssassin ? chips(selected, 1, 'crimson') : <p className="table-phase-detail">{t('assassin.contemplating')}</p>}
      </>,
    );
  return null;
}
