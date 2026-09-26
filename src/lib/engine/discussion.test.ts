import { describe, expect, it } from 'vitest';
import { createGame, reduce } from './reducer';
import { createRng } from './rng';
import { leaderId } from './fsm';
import { projectStateForViewer } from './projection';
import { DEFAULT_OPTIONS } from './testkit';
import type { GameEvent, GameState } from './types';

function step(state: GameState, event: GameEvent, now = 1000): GameState {
  const result = reduce(state, event, { now, rng: createRng('discussion') });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function ready(count = 5, speechSeconds?: number): GameState {
  const created = createGame({
    hostId: 'p0', seed: 'discussion', options: { ...DEFAULT_OPTIONS, speechSeconds },
    players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = step(created.state, { type: 'START_GAME', by: 'p0' });
  for (const p of state.players) state = step(state, { type: 'ACK_ROLE', by: p.id });
  return state;
}

function discuss(state = ready()) {
  const team = state.players.slice(0, 2).map((p) => p.id);
  return step(state, { type: 'PROPOSE_TEAM', by: leaderId(state), team }, 3000);
}

function voting() {
  let state = discuss();
  for (const by of state.discussion!.order) state = step(state, { type: 'END_SPEECH', by }, 4000);
  return step(state, { type: 'FINALIZE_TEAM', by: leaderId(state), team: state.proposedTeam! }, 5000);
}

describe('fixed proposal discussion', () => {
  it.each([2, 3] as const)('retains the original speaking order for v%i event logs', (version) => {
    let state = ready();
    state.flowVersion = version;
    state = step(state, { type: 'PROPOSE_TEAM', by: leaderId(state), team: ['p0', 'p1'] });
    if (version === 2) {
      expect(state.phase).toBe('TeamAnnouncement');
      state = step(state, { type: 'START_DISCUSSION', by: leaderId(state) });
    }
    expect(state.phase).toBe('Discussion');
    expect(state.discussion?.speakerIndex).toBe(0);
    expect(state.discussion?.order[0]).toBe(leaderId(state));
  });

  it('allows a referee to skip only the current speaker and records the action', () => {
    let state = discuss();
    const first = state.discussion!.order[0]!;
    const before = structuredClone(state);
    state = step(state, { type: 'SKIP_SPEECH', target: first, actor: 'Referee' }, 8000);
    expect(before.discussion?.speakerIndex).toBe(0);
    expect(state.discussion?.speakerIndex).toBe(1);
    expect(state.actionTimers).toEqual([expect.objectContaining({
      playerId: state.discussion!.order[1], action: 'speak', startedAt: 8000,
    })]);
    expect(state.logs.at(-2)).toMatchObject({
      key: 'admin.speechSkipped', channel: 'public', style: 'admin', params: { actor: 'Referee', player: first },
    });
    const current = structuredClone(state);
    expect(reduce(state, { type: 'SKIP_SPEECH', target: first, actor: 'Referee' }, { now: 9000, rng: createRng('skip') }))
      .toMatchObject({ ok: false, error: { code: 'NOT_SPEAKER' } });
    expect(state).toEqual(current);
    for (const target of state.discussion!.order.slice(1))
      state = step(state, { type: 'SKIP_SPEECH', target, actor: 'Referee' });
    expect(state.phase).toBe('TeamFinalizing');
    expect(state.proposedTeam).toEqual(before.proposedTeam);
    expect(reduce(state, { type: 'SKIP_SPEECH', target: first, actor: 'Referee' }, { now: 9000, rng: createRng('skip') }))
      .toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  });

  it.each([5, 6, 7, 8, 9, 10])('requires each of %i seats to speak once, ending with the leader', (count) => {
    let state = ready(count);
    state.leaderIndex = count - 2;
    const team = state.players.slice(0, count >= 8 ? 3 : 2).map((p) => p.id);
    state = step(state, { type: 'PROPOSE_TEAM', by: leaderId(state), team });
    expect(state.phase).toBe('Discussion');
    expect(projectStateForViewer(state, 'spectator').proposedTeam).toEqual(team);
    for (const event of [
      { type: 'CAST_VOTE', by: 'p0', value: 'approve' },
      { type: 'FINALIZE_TEAM', by: leaderId(state), team },
      { type: 'START_DISCUSSION', by: 'p0' },
    ] satisfies GameEvent[]) expect(reduce(state, event, { now: 1, rng: createRng('x') }).ok).toBe(false);
    const order = state.discussion!.order;
    expect(order).toEqual(Array.from({ length: count }, (_, i) => `p${(count - 1 + i) % count}`));
    expect(order.at(-1)).toBe(leaderId(state));
    expect(state.logs.at(-1)).toMatchObject({ key: 'speechBegins', params: { player: order[0] } });
    for (const [index, by] of order.entries()) {
      expect(state.phase).toBe('Discussion');
      expect(state.discussion?.speakerIndex).toBe(index);
      const before = structuredClone(state);
      const wrong = order[(index + 1) % count]!;
      expect(reduce(state, { type: 'END_SPEECH', by: wrong }, { now: 1, rng: createRng('x') }))
        .toMatchObject({ ok: false, error: { code: 'NOT_SPEAKER' } });
      expect(state).toEqual(before);
      state = step(state, { type: 'END_SPEECH', by });
    }
    expect(state.phase).toBe('TeamFinalizing');
    expect(state.votes).toEqual({});
    const finalTeam = state.players.slice(-team.length).map((p) => p.id);
    expect(reduce(state, { type: 'FINALIZE_TEAM', by: 'p0', team: finalTeam }, { now: 1, rng: createRng('x') }).ok).toBe(false);
    expect(reduce(state, { type: 'FINALIZE_TEAM', by: leaderId(state), team: [] }, { now: 1, rng: createRng('x') }).ok).toBe(false);
    state = step(state, { type: 'FINALIZE_TEAM', by: leaderId(state), team: finalTeam });
    expect(state.phase).toBe('Voting');
    expect(state.proposedTeam).toEqual(finalTeam);
  });

  it('starts a fresh discussion after a rejected vote', () => {
    let state = voting();
    const previousLeader = state.leaderIndex;
    for (const p of state.players) state = step(state, { type: 'CAST_VOTE', by: p.id, value: 'reject' });
    expect(state).toMatchObject({ phase: 'TeamBuilding', rejectionCount: 1, discussion: null });
    expect(state.leaderIndex).toBe((previousLeader + 1) % 5);
    state = discuss(state);
    expect(state.discussion?.order[0]).toBe(state.players[(state.leaderIndex + 1) % 5]!.id);
    expect(state.discussion?.order.at(-1)).toBe(leaderId(state));
    expect(state.discussion?.speakerIndex).toBe(0);
  });

  it('restores the last speaking turn when a referee rewinds finalization', () => {
    let state = discuss();
    for (const by of state.discussion!.order) state = step(state, { type: 'END_SPEECH', by });
    const team = state.proposedTeam;
    state = step(state, { type: 'PREVIOUS_PHASE', actor: 'ref' }, 9000);
    expect(state.phase).toBe('Discussion');
    expect(state.discussion?.speakerIndex).toBe(4);
    expect(state.proposedTeam).toEqual(team);
    expect(state.actionTimers).toEqual([expect.objectContaining({ action: 'speak', playerId: leaderId(state), startedAt: 9000 })]);
  });
});

describe('advisory action timers', () => {
  it('defaults to two minutes for speech and twenty seconds for other actions', () => {
    const state = ready();
    expect(state.actionTimers).toEqual([{ playerId: leaderId(state), action: 'propose', startedAt: 1000, durationMs: 20_000 }]);
    const discussion = discuss(state);
    expect(discussion.actionTimers).toEqual([{ playerId: discussion.discussion!.order[0], action: 'speak', startedAt: 3000, durationMs: 120_000 }]);
    expect(discuss(ready(5, 90)).actionTimers?.[0]?.durationMs).toBe(90_000);
  });

  it('times identity confirmation first, then starts the player’s pending action', () => {
    let state = ready();
    state = step(state, { type: 'REROLL_ROLES', actor: 'ref' }, 2000);
    expect(state.actionTimers).toHaveLength(5);
    expect(state.actionTimers?.every((timer) => timer.action === 'role' && timer.startedAt === 2000)).toBe(true);
    state = step(state, { type: 'ACK_ROLE', by: leaderId(state), roleRevision: state.roleRevision }, 25_000);
    expect(state.actionTimers?.find((timer) => timer.playerId === leaderId(state)))
      .toMatchObject({ action: 'propose', startedAt: 25_000, durationMs: 20_000 });
    expect(state.actionTimers?.filter((timer) => timer.action === 'role').every((timer) => timer.startedAt === 2000)).toBe(true);
  });

  it('keeps an overdue speaker active across disconnects and accepts a late finish', () => {
    let state = discuss();
    const timers = structuredClone(state.actionTimers);
    const by = state.discussion!.order[0]!;
    state = step(state, { type: 'SET_CONNECTED', by, connected: false }, 9_000_000);
    expect(state.actionTimers).toEqual(timers);
    expect(state.phase).toBe('Discussion');
    expect(state.discussion?.speakerIndex).toBe(0);
    state = step(state, { type: 'END_SPEECH', by }, 9_000_001);
    expect(state.discussion?.speakerIndex).toBe(1);
    expect(state.actionTimers?.[0]).toMatchObject({ playerId: state.discussion!.order[1], startedAt: 9_000_001 });
  });

  it('tracks simultaneous votes independently without resetting other voters', () => {
    let state = voting();
    expect(state.actionTimers).toHaveLength(5);
    state = step(state, { type: 'CAST_VOTE', by: 'p0', value: 'approve' }, 100_000);
    expect(state.actionTimers).toHaveLength(4);
    expect(state.actionTimers?.every((timer) => timer.startedAt === 5000 && timer.playerId !== 'p0')).toBe(true);
    const view = projectStateForViewer(state, 'spectator');
    expect(view.votes?.every((vote) => vote.vote === undefined)).toBe(true);
    expect(view.actionTimers).toEqual(state.actionTimers);
    state = step(state, { type: 'RETRACT_VOTES' }, 110_000);
    expect(state.actionTimers).toHaveLength(5);
    expect(state.actionTimers?.every((timer) => timer.startedAt === 110_000)).toBe(true);
  });

  it('times only mission participants, hides submitted cards, and clears timers at game end', () => {
    let state = voting();
    for (const p of state.players) state = step(state, { type: 'CAST_VOTE', by: p.id, value: 'approve' }, 6000);
    expect(state.actionTimers?.map((timer) => timer.playerId)).toEqual(state.proposedTeam);
    state = step(state, { type: 'CAST_MISSION_CARD', by: state.proposedTeam![0]!, card: 'success' }, 80_000);
    expect(state.actionTimers).toEqual([expect.objectContaining({ playerId: state.proposedTeam![1], action: 'mission', startedAt: 6000 })]);
    expect(projectStateForViewer(state, 'spectator')).not.toHaveProperty('missionCards');
    state = step(state, { type: 'START_ASSASSINATION', by: state.assassinId! }, 90_000);
    expect(state.actionTimers).toEqual([expect.objectContaining({ playerId: state.assassinId, action: 'assassinate', durationMs: 180_000 })]);
    state = step(state, { type: 'ASSASSINATE', by: state.assassinId!, target: state.players.find((p) => p.role === 'Merlin')!.id }, 120_000);
    expect(state.actionTimers).toEqual([]);
  });

  it.each([[undefined, 180_000], [90, 135_000], [45, 67_500]] as const)(
    'gives the assassination discussion 1.5 times a %s second speech',
    (speechSeconds, durationMs) => {
      const state = ready(5, speechSeconds);
      const next = step(state, { type: 'START_ASSASSINATION', by: state.assassinId! }, 7000);
      expect(next.actionTimers).toEqual([{ playerId: state.assassinId, action: 'assassinate', startedAt: 7000, durationMs }]);
    },
  );

  it('times the Lady inspection and preserves timestamps through serialization', () => {
    let state = ready();
    state.phase = 'LadyOfLake';
    state.ladyEnabled = true;
    state.ladyHolderId = 'p0';
    state = step(state, { type: 'SET_CONNECTED', by: 'p0', connected: true }, 4000);
    expect(state.actionTimers).toEqual([expect.objectContaining({ playerId: 'p0', action: 'lady', startedAt: 4000, durationMs: 20_000 })]);
    const restored: GameState = JSON.parse(JSON.stringify(state));
    expect(projectStateForViewer(restored, 'spectator').actionTimers).toEqual(state.actionTimers);
  });
});
