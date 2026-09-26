import { describe, expect, it } from 'vitest';
import { reduce } from './reducer';
import { createRng } from './rng';
import { buildStartedGame, FIVE_P, proposeForVote } from './testkit';
import { projectStateForViewer } from './projection';
import { actionTime } from '../game/actionTimer';
import type { GameEvent, GameState } from './types';

function step(state: GameState, event: GameEvent, now: number) {
  const result = reduce(state, event, { now, rng: createRng('timers') });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
function ready() {
  const state = buildStartedGame(FIVE_P);
  state.roleAcks = state.players.map((p) => p.id);
  return step(state, { type: 'SET_CONNECTED', by: 'p0', connected: true }, 1000);
}
function speaking() {
  return step(ready(), { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] }, 1000);
}
const pause: GameEvent = { type: 'SET_TIMERS_PAUSED', paused: true, actor: 'Referee' };
const resume: GameEvent = { type: 'SET_TIMERS_PAUSED', paused: false, actor: 'Referee' };

describe('referee timer controls', () => {
  it.each([31_000, 181_000, 301_000])('freezes countdown/overtime at %i and resumes without counting the pause', (at) => {
    let state = speaking();
    const before = structuredClone(state);
    const frozen = actionTime(state.actionTimers![0]!, at);
    state = step(state, pause, at);
    expect(before.actionTimers?.[0]?.pausedAt).toBeUndefined();
    expect(state.phase).toBe('Discussion');
    expect(state.discussion).toEqual(before.discussion);
    expect(actionTime(state.actionTimers![0]!, at + 600_000)).toEqual(frozen);
    expect(state.logs.at(-1)).toMatchObject({ key: 'admin.timersPaused', style: 'admin' });
    expect(projectStateForViewer(JSON.parse(JSON.stringify(state)), 'spectator').actionTimers)
      .toEqual(state.actionTimers);
    state = step(state, resume, at + 600_000);
    expect(state.actionTimers?.[0]?.pausedAt).toBeUndefined();
    expect(actionTime(state.actionTimers![0]!, at + 600_000)).toEqual(frozen);
    expect(actionTime(state.actionTimers![0]!, at + 601_000).display).not.toBe(frozen.display);
    expect(state.logs.at(-1)).toMatchObject({ key: 'admin.timersResumed', style: 'admin' });
  });

  it('makes repeated pause/resume requests idempotent', () => {
    let state = step(speaking(), pause, 11_000);
    const frozen = structuredClone(state);
    state = step(state, pause, 21_000);
    expect(state).toEqual(frozen);
    state = step(state, resume, 31_000);
    const resumed = structuredClone(state);
    state = step(state, resume, 41_000);
    expect(state).toEqual(resumed);
    expect(state.actionTimers?.[0]?.startedAt).toBe(21_000);
  });

  it('freezes all pending voters while allowing submissions, then starts fresh mission timers', () => {
    let state = proposeForVote(ready(), { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] },
      { now: 1000, rng: createRng('vote') });
    state = step(state, pause, 11_000);
    expect(state.actionTimers).toHaveLength(5);
    expect(state.actionTimers?.every((timer) => timer.pausedAt === 11_000)).toBe(true);
    state = step(state, { type: 'CAST_VOTE', by: 'p0', value: 'approve' }, 51_000);
    expect(state.actionTimers).toHaveLength(4);
    expect(state.actionTimers?.every((timer) => actionTime(timer, 91_000).display === '10')).toBe(true);
    for (const p of state.players.slice(1)) state = step(state, { type: 'CAST_VOTE', by: p.id, value: 'approve' }, 91_000);
    expect(state.phase).toBe('MissionVote');
    expect(state.actionTimers).toHaveLength(2);
    expect(state.actionTimers?.every((timer) => timer.pausedAt === undefined && timer.startedAt === 91_000)).toBe(true);
  });

  it.each(['END_SPEECH', 'SKIP_SPEECH'] as const)('starts the next speaker’s clock after %s while paused', (type) => {
    let state = step(speaking(), pause, 11_000);
    const by = state.discussion!.order[0]!;
    state = step(state, type === 'END_SPEECH' ? { type, by } : { type, target: by, actor: 'Referee' }, 51_000);
    expect(state.discussion?.speakerIndex).toBe(1);
    expect(state.actionTimers).toEqual([{ playerId: state.discussion!.order[1], action: 'speak', startedAt: 51_000, durationMs: 120_000 }]);
  });

  it('keeps new actions in the same paused phase frozen, then restarts them on referee rollback', () => {
    let state = buildStartedGame(FIVE_P);
    state = step(state, { type: 'SET_CONNECTED', by: 'p0', connected: true }, 1000);
    state = step(state, pause, 11_000);
    state = step(state, { type: 'ACK_ROLE', by: 'p0' }, 31_000);
    expect(state.actionTimers?.find((timer) => timer.playerId === 'p0'))
      .toMatchObject({ action: 'propose', pausedAt: 31_000, startedAt: 31_000 });
    state = step(state, { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] }, 51_000);
    expect(state.actionTimers?.every((timer) => timer.pausedAt === undefined)).toBe(true);
    // Identity clocks retain their elapsed ten seconds across the phase change.
    expect(actionTime(state.actionTimers!.find((timer) => timer.playerId === 'p2')!, 51_000).display).toBe('10');
    state = step(state, pause, 61_000);
    state = step(state, { type: 'PREVIOUS_PHASE', actor: 'Referee' }, 91_000);
    expect(state.phase).toBe('TeamBuilding');
    expect(state.actionTimers?.every((timer) => timer.pausedAt === undefined)).toBe(true);
    expect(state.actionTimers?.find((timer) => timer.action === 'propose')?.startedAt).toBe(91_000);
  });

  it('refuses pause or resume when no timer is available', () => {
    for (const phase of ['Lobby', 'GameOver'] as const) {
      const state = { ...ready(), phase, actionTimers: [] };
      for (const event of [pause, resume])
        expect(reduce(state, event, { now: 1000, rng: createRng('invalid') }))
          .toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
    }
  });
});
