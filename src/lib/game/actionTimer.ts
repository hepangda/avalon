import type { ActionTimer } from '@/lib/engine';

export function actionTime(timer: ActionTimer, now: number) {
  const remaining = timer.startedAt + timer.durationMs - (timer.pausedAt ?? now);
  const overdue = remaining <= 0;
  const seconds = overdue ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000);
  const remainingFraction = timer.durationMs > 0
    ? Math.max(0, Math.min(1, remaining / timer.durationMs))
    : 0;
  const overtimeFraction = timer.durationMs > 0
    ? Math.max(0, Math.min(1, -remaining / timer.durationMs))
    : Number(overdue);
  return { overdue, remainingFraction, overtimeFraction, display: String(seconds) };
}
