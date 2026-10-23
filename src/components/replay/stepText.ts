import { useTranslations } from 'use-intl';
import type { ReplayStep } from '@/lib/game/replaySteps';

/** The tone a beat leaves on the timeline: what was decided there. */
export function stepTone(step: ReplayStep): string | undefined {
  switch (step.kind) {
    case 'vote': return step.proposal.approved ? 'approve' : 'reject';
    case 'quest': return step.mission.success ? 'success' : 'fail';
    case 'lady': return 'lady';
    case 'strike': return step.assassination.hitMerlin ? 'fail' : 'success';
    case 'end': return 'end';
    default: return undefined;
  }
}

/** A beat's name, as the status line, the log and the scrubber call it. */
export function useStepLabel() {
  const t = useTranslations();
  return (step: ReplayStep) => {
    const mission = t('replay.mission', { n: step.roundIndex + 1 });
    switch (step.kind) {
      case 'deal': return t('replay.deal');
      case 'vote': return `${mission} · ${t('vote.proposalLabel', { n: step.proposal.proposalIndex + 1 })}`;
      case 'quest': return `${mission} · ${t('replay.quest')}`;
      case 'lady': return `${mission} · ${t('lady.title')}`;
      case 'strike': return t('assassin.title');
      case 'end': return t('replay.end');
    }
  };
}
