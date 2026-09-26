import { expect, it } from 'vitest';
import { actionTime } from './actionTimer';

it('freezes both time and fill, including a pause at epoch zero', () => {
  const timer = { playerId: 'p0', action: 'speak' as const, startedAt: -10_000, durationMs: 20_000, pausedAt: 0 };
  expect(actionTime(timer, 99_000)).toEqual(actionTime(timer, 0));
  expect(actionTime(timer, 99_000)).toMatchObject({ display: '10', remainingFraction: 0.5, overtimeFraction: 0 });
});

it('shows a countdown and continuing overtime at the exact deadline', () => {
  const timer = { playerId: 'p0', action: 'speak' as const, startedAt: 1000, durationMs: 120_000 };
  expect(actionTime(timer, 1000)).toMatchObject({ overdue: false, display: '120', remainingFraction: 1 });
  expect(actionTime(timer, 61_000)).toMatchObject({ overdue: false, display: '60', remainingFraction: 0.5 });
  expect(actionTime(timer, 120_999)).toMatchObject({ overdue: false, display: '1' });
  expect(actionTime(timer, 121_000)).toMatchObject({ overdue: true, display: '0', remainingFraction: 0 });
  expect(actionTime(timer, 121_999)).toMatchObject({ overdue: true, display: '0', remainingFraction: 0 });
  expect(actionTime(timer, 122_000)).toMatchObject({ overdue: true, display: '1', remainingFraction: 0 });
  expect(actionTime(timer, 186_000)).toMatchObject({ overdue: true, display: '65', remainingFraction: 0 });
  expect(actionTime(timer, 0).remainingFraction).toBe(1);
});


it.each([20_000, 90_000, 120_000])('fills red over the same %i ms as green, then keeps it full', (durationMs) => {
  const timer = { playerId: 'p0', action: 'speak' as const, startedAt: 1000, durationMs };
  const sample = (elapsed: number) => actionTime(timer, timer.startedAt + elapsed);
  expect(sample(0)).toMatchObject({ remainingFraction: 1, overtimeFraction: 0 });
  expect(sample(durationMs / 2)).toMatchObject({ remainingFraction: 0.5, overtimeFraction: 0 });
  expect(sample(durationMs)).toMatchObject({ overdue: true, remainingFraction: 0, overtimeFraction: 0 });
  expect(sample(durationMs * 1.5)).toMatchObject({ remainingFraction: 0, overtimeFraction: 0.5 });
  const full = sample(durationMs * 2);
  const later = sample(durationMs * 3);
  expect(full).toMatchObject({ overdue: true, remainingFraction: 0, overtimeFraction: 1 });
  expect(later).toMatchObject({ overdue: true, remainingFraction: 0, overtimeFraction: 1 });
  expect(later.display).not.toBe(full.display);
});
