import type { ClientGameState } from '@/lib/engine';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import type { TablePresentation } from '@/lib/game/tablePresentation';
import { useTranslations } from 'use-intl';
import { TableCard } from './TableCard';

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
  function chips(ids: string[]) {
    return (
      <div className="table-team-chips">
        {ids.map((id) => {
          const p = game!.players.find((player) => player.id === id);
          return (
            p && (
              <span key={id} className="table-team-chip">
                <b className="font-medium">{p.seat + 1}</b>
                <span>{p.name}</span>
              </span>
            )
          );
        })}
      </div>
    );
  }
  let board;
  if (presentation?.kind === 'mission' || presentation?.kind === 'assassination') board = null;
  else if (presentation?.kind === 'vote')
    board = (
      <>
        <h2 className="table-phase-title">
          {t(
            presentation.record.approved
              ? 'cue.voteApproved'
              : 'cue.voteRejected',
          )}
        </h2>
        {chips(presentation.record.team)}
        <p className="table-phase-detail">
          {t('vote.tally', {
            approves: presentation.record.votes.filter(
              (v) => v.vote === 'approve',
            ).length,
            rejects: presentation.record.votes.filter(
              (v) => v.vote === 'reject',
            ).length,
          })}
        </p>
      </>
    );
  else if (isOver)
    board = (
      <>
        <h1 className="table-phase-title outcome-title" data-winner={game.outcome?.winner}>
          {t(
            game.outcome?.winner === 'good'
              ? 'gameOver.goodTriumphs'
              : 'gameOver.evilPrevails',
          )}
        </h1>
        {game.outcome && (
          <p className="table-phase-detail">
            {t(`gameOver.${outcomeReasonKey(game.outcome)}`)}
          </p>
        )}
      </>
    );
  else if (game.phase === 'TeamAnnouncement' || game.phase === 'Discussion')
    board = (
      <>
        <h2 className="table-phase-title" aria-live="polite">
          {game.phase === 'TeamAnnouncement' ? t('discussion.announced') : t('discussion.speaking', {
            name: speaker ? `${speaker.seat + 1}. ${speaker.name}` : '',
          })}
        </h2>
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
      </>
    );
  else if (game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing')
    board = (
      <>
        <h2 className="table-phase-title">
          {game.phase === 'TeamFinalizing' ? t('discussion.finalizing') : isLeader
            ? t('teamBuilder.youLead')
            : t('teamBuilder.leaderChoosing', {
              name: leader ? `${leader.seat + 1}. ${leader.name}` : '',
            })}
        </h2>
        {game.phase === 'TeamFinalizing' && <p className="table-phase-detail">{t('discussion.finalizingHint')}</p>}
        {game.phase === 'TeamFinalizing' && !isLeader ? chips(team) : selected.length > 0 ? (
          chips(selected)
        ) : (
          <p className="table-phase-detail">
            {t('teamBuilder.selectKnights', {
              size: teamSize,
              round: round + 1,
            })}
          </p>
        )}
      </>
    );
  else if (game.phase === 'Voting')
    board = (
      <>
        <h2 className={`table-phase-title${game.teamChanged ? ' is-team-changed' : ''}`} aria-live="polite">
          {t(game.teamChanged ? 'discussion.teamChanged' : canVote ? 'table.voteQuestion' : 'table.waitingVotes')}
        </h2>
        {chips(team)}
      </>
    );
  else if (game.phase === 'MissionVote')
    board = (
      <>
        <h2 className="table-phase-title" aria-live="polite">
          {t(canMission ? 'table.missionPrompt' : 'table.waitingMissionCards')}
        </h2>
        <p className="table-phase-detail">
          {t(
            game.config.requiredFails[round] === 2
              ? 'table.twoFails'
              : 'missionVote.oneFailSpoils',
          )}
        </p>
      </>
    );
  else if (game.phase === 'LadyOfLake')
    board = (
      <>
        <h2 className="table-phase-title">{t('lady.title')}</h2>
        <p className="table-phase-detail">
          {isHolder
            ? t('lady.chooseExamine')
            : t('lady.gazingWaters', {
              name:
                game.players.find((p) => p.id === game.lady?.holderId)
                  ?.name ?? '',
            })}
        </p>
        {chips(selected)}
      </>
    );
  else if (game.phase === 'Assassination')
    board = (
      <>
        <h2 className="table-phase-title">{t('assassin.title')}</h2>
        <div
          className="table-public-roles"
          aria-label={t('assassin.identitiesPublic')}
        >
          {game.players
            .filter((p) => p.role && ROLE_TEAM_UI[p.role] === 'evil')
            .map((p) => (
              <div className="table-public-role" key={p.id}>
                <TableCard role={p.role} />
                <span>
                  {p.seat + 1}. {p.name}
                </span>
              </div>
            ))}
        </div>
        <p className="table-phase-detail">
          {t(isAssassin ? 'assassin.nameMerlin' : 'assassin.contemplating')}
        </p>
      </>
    );
  return board;
}
