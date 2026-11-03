import { useTranslations } from 'use-intl';
import type { ActionTimer } from '@/lib/engine';
import { actionTime } from '@/lib/game/actionTimer';

export function ActionTimerBadge({ timer, now }: { timer: ActionTimer; now: number }) {
  const t = useTranslations();
  const { overdue, display } = actionTime(timer, now);
  return (
    <span className="action-timer" data-overdue={overdue}>
      <span>{t(`timing.${timer.action}`)}</span>
      <span className="tabular-nums">{t(overdue ? 'timing.overdue' : 'timing.seconds', { time: display })}</span>
      {timer.pausedAt !== undefined && <span>{t('timing.paused')}</span>}
    </span>
  );
}
