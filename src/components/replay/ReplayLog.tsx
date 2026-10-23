import { useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import type { ReplayModel } from '@/lib/game/replayModel';
import type { ReplayStep } from '@/lib/game/replaySteps';
import { useRoleText } from '@/lib/game/useRoleText';
import { stepTone, useStepLabel } from './stepText';

/** The whole game as a list of beats beside the table; choosing one turns the table to it. */
export function ReplayLog({ model, steps, index, onSeek }: {
  model: ReplayModel;
  steps: ReplayStep[];
  index: number;
  onSeek: (index: number) => void;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const label = useStepLabel();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const face = (id: string | null) => {
    const p = id ? model.byId.get(id) : undefined;
    return p && (
      <PlayerAvatar key={p.id} playerId={p.id} avatarUrl={p.avatarUrl} name={p.name} className="replay-log-face">
        <b>{p.seat + 1}</b>
      </PlayerAvatar>
    );
  };
  const detail = (step: ReplayStep) => {
    switch (step.kind) {
      case 'vote':
        return <>
          {face(step.proposal.leaderId)}
          <span className="replay-log-arrow" aria-hidden="true">›</span>
          <span className="replay-log-team">{step.proposal.team?.map(face)}</span>
          <span className="replay-log-tally">{step.proposal.approves}:{step.proposal.rejects}</span>
        </>;
      case 'quest':
        return <>
          <span className="replay-log-team">{step.mission.team?.map(face)}</span>
          <span className="replay-log-tally">{t('replay.failCards', { count: step.mission.failCount ?? 0 })}</span>
        </>;
      case 'lady':
        return <>
          {face(step.check.holderPlayerId)}
          <span className="replay-log-arrow" aria-hidden="true">›</span>
          {face(step.check.targetPlayerId)}
          <span className="replay-log-tally" data-team={step.check.revealedTeam}>{roleText.teamShort(step.check.revealedTeam)}</span>
        </>;
      case 'strike':
        return <>
          {face(step.assassination.assassinPlayerId)}
          <GameIcon name="assassinate" className="replay-log-icon" />
          {face(step.assassination.targetPlayerId)}
        </>;
      case 'end':
        return model.outcome && <span className="replay-log-tally" data-team={model.outcome.winner}>
          {t(model.outcome.winner === 'good' ? 'gameOver.goodTriumphs' : 'gameOver.evilPrevails')}
        </span>;
      default:
        return null;
    }
  };
  return (
    <div className="replay-log">
      <h2 className="replay-log-title">{t('log.panelTitle')}</h2>
      <ol ref={list} className="replay-log-list">
        {steps.map((step, i) => (
          <li key={step.key} data-break={i > 0 && steps[i - 1]!.roundIndex !== step.roundIndex ? '' : undefined}>
            <button type="button" className="replay-log-step" data-tone={stepTone(step)}
              aria-current={i === index ? 'step' : undefined} onClick={() => onSeek(i)}>
              <span className="replay-log-label">{label(step)}</span>
              <span className="replay-log-detail">{detail(step)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
