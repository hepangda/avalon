import { useTranslations } from 'use-intl';
import type { ActionTimer } from '@/lib/engine';
import { actionTime } from '@/lib/game/actionTimer';

/** Green drains top to bottom; red rises over the same duration, then stays full. */
export function ActionTimerBar({ timer, now }: { timer: ActionTimer; now: number }) {
  const t = useTranslations();
  const { overdue, display, remainingFraction, overtimeFraction } = actionTime(timer, now);
  const value = `${overdue ? '+' : ''}${display}`;
  const paused = timer.pausedAt !== undefined;
  return (
    <span className="table-card-slot action-timer-bar" data-overdue={overdue} data-paused={paused} role="timer"
      title={paused ? t('timing.paused') : undefined}
      aria-label={`${t(`timing.${timer.action}`)} · ${t(overdue ? 'timing.overdue' : 'timing.seconds', { time: display })}${paused ? ` · ${t('timing.paused')}` : ''}`}>
      <span key={`${timer.playerId}-${timer.action}-${timer.startedAt}`} className="action-timer-bar-fill" aria-hidden="true"
        style={{ transform: `scaleY(${overdue ? overtimeFraction : remainingFraction})` }} />
      <span className="action-timer-bar-value" aria-hidden="true"
        style={{ fontSize: `min(max(11px, calc(var(--card-width) * 0.3)), calc((var(--card-width) - 4px) / ${value.length * 0.6}))` }}>{value}</span>
      {paused && <span className="action-timer-paused" aria-hidden="true">Ⅱ</span>}
    </span>
  );
}
