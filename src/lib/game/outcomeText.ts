import type { GameOutcome } from '@/lib/engine';

/** Explain the actual winning condition, including custom discussion limits. */
export function outcomeReasonKey(outcome: Pick<GameOutcome, 'winner' | 'reason'>) {
  switch (outcome.reason) {
    case 'three_missions':
      return outcome.winner === 'good' ? 'reasonThreeSuccesses' : 'reasonThreeFailures';
    case 'five_rejections':
      return 'reasonFiveRejections';
    case 'rejection_limit':
      return 'reasonRejectionLimit';
    case 'assassinated_merlin':
      return 'reasonAssassinatedMerlin';
    case 'assassin_missed':
      return 'reasonAssassinMissed';
  }
}
