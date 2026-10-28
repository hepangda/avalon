import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import { bySeat } from '@/lib/game/playerLabel';
import type { ReplayModel } from '@/lib/game/replayModel';
import type { ReplayStep } from '@/lib/game/replaySteps';
import { useRoleText } from '@/lib/game/useRoleText';

/** What the felt says at one beat: the same title-and-body layout as a live table. */
export function ReplayBoard({ model, step, viewpoint }: { model: ReplayModel; step: ReplayStep; viewpoint: string | null }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const seat = (id: string | null | undefined) => {
    const p = id ? model.byId.get(id) : undefined;
    return p ? `${p.seat + 1}. ${p.name}` : '';
  };
  const layout = (title: ReactNode, body?: ReactNode) => (
    <>
      <div className="table-board-title">{title}</div>
      <div className="table-board-body">{body}</div>
    </>
  );
  const chips = (ids: string[], tone: 'gold' | 'sky' | 'crimson' = 'gold') => (
    <ol className="table-team-chips" data-tone={tone}>
      {bySeat(model, ids).map((id) => {
        const p = model.byId.get(id);
        if (!p) return null;
        return (
          <li key={id} className="table-team-chip" title={`${p.seat + 1}. ${p.name}`}>
            <PlayerAvatar playerId={p.id} avatarUrl={p.avatarUrl} name={p.name} className="table-team-avatar">
              <b className="table-team-seat">{p.seat + 1}</b>
            </PlayerAvatar>
            <span className="table-team-name">{p.name}</span>
          </li>
        );
      })}
    </ol>
  );

  switch (step.kind) {
    case 'deal':
      return layout(
        <h2 className="table-phase-title">{t('replay.deal')}</h2>,
        <p className="table-phase-detail">{t('replay.lineup', {
          good: model.players.filter((p) => p.team === 'good').length,
          evil: model.players.filter((p) => p.team === 'evil').length,
        })}</p>,
      );
    case 'vote': {
      const { proposal } = step;
      return layout(
        <h2 className="table-phase-title vote-verdict" data-result={proposal.approved ? 'approve' : 'reject'}>
          {t(proposal.approved ? 'cue.voteApproved' : 'cue.voteRejected')}
        </h2>,
        <>
          {proposal.team ? chips(proposal.team) : null}
          <p className="replay-tally">
            <span data-side="approve"><GameIcon name="approve" />{proposal.approves}</span>
            <span data-side="reject"><GameIcon name="reject" />{proposal.rejects}</span>
          </p>
        </>,
      );
    }
    case 'quest': {
      const { mission } = step;
      return layout(
        <h2 className="table-phase-title replay-quest-title" data-result={mission.success ? 'success' : 'fail'}>
          <GameIcon name={mission.success ? 'missionSuccess' : 'missionFail'} className="replay-quest-seal" />
          {t(mission.success ? 'cue.missionSuccess' : 'cue.missionFail')}
        </h2>,
        <>
          {mission.team && chips(mission.team, 'sky')}
          <p className="table-phase-detail">
            {t('replay.failCards', { count: mission.failCount ?? 0 })}
            {mission.requiredFails === 2 && ` · ${t('table.twoFails')}`}
          </p>
        </>,
      );
    }
    case 'lady':
      return layout(
        <h2 className="table-phase-title">{t('lady.examines', { holder: seat(step.check.holderPlayerId), target: seat(step.check.targetPlayerId) })}</h2>,
        <div className="table-lady-pool">
          <GameIcon name="lady" className="table-lady-emblem" />
          {/* Only the holder learned the answer. */}
          {(!viewpoint || viewpoint === step.check.holderPlayerId) && (
            <span className="replay-team-word" data-team={step.check.revealedTeam}>{roleText.teamShort(step.check.revealedTeam)}</span>
          )}
        </div>,
      );
    case 'strike':
      return layout(
        <h2 className="table-phase-title">{t(step.assassination.hitMerlin ? 'assassin.hitTitle' : 'assassin.missTitle')}</h2>,
        <>
          {chips([step.assassination.targetPlayerId], 'crimson')}
          <p className="table-phase-detail">{t('replay.struckBy', { assassin: seat(step.assassination.assassinPlayerId) })}</p>
        </>,
      );
    case 'end':
      return model.outcome && layout(
        <h1 className="table-phase-title outcome-title" data-winner={model.outcome.winner}>
          {t(model.outcome.winner === 'good' ? 'gameOver.goodTriumphs' : 'gameOver.evilPrevails')}
        </h1>,
        <p className="table-phase-detail outcome-reason">{t(`gameOver.${outcomeReasonKey(model.outcome)}`)}</p>,
      );
  }
}
