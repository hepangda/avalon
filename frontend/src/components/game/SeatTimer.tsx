import { useTranslations } from 'use-intl';
import type { ActionTimer } from '@/lib/engine';
import { actionTime } from '@/lib/game/actionTimer';

/** A ring around the player's portrait: gilt drains clockwise, then red creeps back over it. */
export function SeatTimer({ timer, now }: { timer: ActionTimer; now: number }) {
  const t = useTranslations();
  const { overdue, display, remainingFraction, overtimeFraction } = actionTime(timer, now);
  const paused = timer.pausedAt !== undefined;
  const fraction = overdue ? overtimeFraction : remainingFraction;
  return (
    <span className="seat-timer" data-overdue={overdue} data-paused={paused} role="timer"
      title={paused ? t('timing.paused') : undefined}
      aria-label={`${t(`timing.${timer.action}`)} · ${t(overdue ? 'timing.overdue' : 'timing.seconds', { time: display })}${paused ? ` · ${t('timing.paused')}` : ''}`}>
      <svg className="seat-timer-ring" viewBox="0 0 40 40" aria-hidden="true">
        <circle className="seat-timer-track" cx="20" cy="20" r="18.5" pathLength="100" />
        <circle key={`${timer.playerId}-${timer.action}-${timer.startedAt}`} className="seat-timer-arc" cx="20" cy="20" r="18.5"
          pathLength="100" style={{ strokeDashoffset: 100 - fraction * 100 }} />
      </svg>
      <span className="seat-timer-value" aria-hidden="true">
        {paused ? 'Ⅱ' : `${overdue ? '+' : ''}${display}`}
      </span>
    </span>
  );
}

/** The player's own clock as a thin gilt fuse along the top of the action dock. */
export function DockTimer({ timer, now }: { timer: ActionTimer; now: number }) {
  const t = useTranslations();
  const { overdue, display, remainingFraction, overtimeFraction } = actionTime(timer, now);
  const paused = timer.pausedAt !== undefined;
  return (
    <span className="dock-timer" data-overdue={overdue} data-paused={paused} role="timer"
      aria-label={`${t(`timing.${timer.action}`)} · ${t(overdue ? 'timing.overdue' : 'timing.seconds', { time: display })}${paused ? ` · ${t('timing.paused')}` : ''}`}>
      <span key={`${timer.playerId}-${timer.action}-${timer.startedAt}`} className="dock-timer-fill" aria-hidden="true"
        style={{ transform: `scaleX(${overdue ? overtimeFraction : remainingFraction})` }} />
    </span>
  );
}
