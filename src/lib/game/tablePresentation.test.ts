import { describe, expect, it } from 'vitest';
import {
  reduce,
  projectStateForViewer,
  createRng,
  type GameEvent,
  type GameState,
} from '@/lib/engine';
import { buildStartedGame, FIVE_P, proposeForVote } from '@/lib/engine/testkit';
import {
  anonymousMissionCards,
  arrangeSeats,
  newTablePresentations,
  tablePresentationReducer,
  type TablePresentationState,
} from './tablePresentation';
import { actionAvailability } from './actionAvailability';
import { completeMission, completeVotes, propose } from '@/lib/debug/scenarios';

const apply = (s: GameState, event: GameEvent) => {
  const result = reduce(s, event, { now: 1, rng: createRng('table') });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const project = (s: GameState) => projectStateForViewer(s, 'p0');
function voting() {
  return proposeForVote(buildStartedGame(FIVE_P), {
    type: 'PROPOSE_TEAM',
    by: 'p0',
    team: ['p0', 'p3'],
  });
}
function approved() {
  let s = voting();
  for (const p of s.players)
    s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
  return s;
}

describe('table presentation across server transitions', () => {
  it.each([
    ['p0', 'Merlin', true],
    ['p1', 'Percival', false],
  ] as const)('queues a confirmed assassination of %s for players and spectators', (target, role, hitMerlin) => {
    const before = apply(buildStartedGame(FIVE_P), { type: 'START_ASSASSINATION', by: 'p4' });
    const after = apply(before, { type: 'ASSASSINATE', by: 'p4', target });
    for (const viewer of ['p0', 'p4', 'spectator']) {
      const previous = projectStateForViewer(before, viewer);
      const next = projectStateForViewer(after, viewer);
      const events = newTablePresentations(previous, next);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'assassination', hitMerlin,
        target: { id: target, role, name: after.players.find((p) => p.id === target)!.name },
      });
      expect(newTablePresentations(previous, previous)).toEqual([]);
      expect(newTablePresentations(next, next)).toEqual([]);
      expect(newTablePresentations(null, next)).toEqual([]);
      expect(newTablePresentations(previous, { ...next, phaseRevision: 1 })).toEqual([]);
    }
  });

  it('does not invent an assassination animation for other game endings', () => {
    const before = project(buildStartedGame(FIVE_P));
    const after = {
      ...before,
      phase: 'GameOver' as const,
      outcome: { winner: 'evil' as const, reason: 'five_rejections' as const, missionTally: { good: 0, evil: 0 }, revealedRoles: [] },
    };
    expect(newTablePresentations(before, after)).toEqual([]);
  });

  it('shows the exact rejected proposal, even though the next leader is already active', () => {
    let s = voting();
    const before = project(s);
    for (const p of s.players)
      s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'reject' });
    expect(s.phase).toBe('TeamBuilding');
    const events = newTablePresentations(before, project(s));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'vote',
      record: { leaderId: 'p0', approved: false, team: ['p0', 'p3'] },
    });
  });
  it('queues vote and mission reveals in order if both arrive in one update', () => {
    const before = project(voting());
    let s = approved();
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p0', card: 'success' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p3', card: 'fail' });
    const events = newTablePresentations(before, project(s));
    expect(events.map((event) => event.kind)).toEqual(['vote', 'mission']);
    expect(events[1]).toMatchObject({
      kind: 'mission',
      team: ['p0', 'p3'],
      result: { failCount: 1, teamSize: 2 },
    });
    expect(events[1]).not.toHaveProperty('cards');
    expect(events[1]).not.toHaveProperty('result.cards');
  });
  it('does not replay history on initial load, a new game, or a referee rollback', () => {
    const end = project(approved());
    expect(newTablePresentations(null, end)).toEqual([]);
    expect(
      newTablePresentations(project(voting()), { ...end, gameId: 'new-game' }),
    ).toEqual([]);
    expect(
      newTablePresentations(project(voting()), { ...end, phaseRevision: 1 }),
    ).toEqual([]);
  });
  it('builds anonymous cards solely from the tally and mixes their order', () => {
    expect(anonymousMissionCards(3, 1, () => 0)).toEqual([
      'success',
      'success',
      'fail',
    ]);
    expect(anonymousMissionCards(3, 1, () => 0.99)).toEqual([
      'fail',
      'success',
      'success',
    ]);
  });
});

describe('war report reveal timing', () => {
  const start = (game: GameState) => tablePresentationReducer(
    { game: null, queue: [] },
    { type: 'sync', game: project(game) },
  );
  const report = (state: TablePresentationState) =>
    state.queue[0]?.reportGame ?? state.game!;
  const finish = (state: TablePresentationState) => tablePresentationReducer(
    state,
    { type: 'finish', id: state.queue[0]!.presentation.id },
  );

  it.each([0, 1])('holds mission results and follow-up logs until the reveal finishes (%i fails)', (fails) => {
    const before = approved();
    const after = project(completeMission(before, fails));
    const pending = tablePresentationReducer(start(before), { type: 'sync', game: after });
    expect(pending.queue[0]?.presentation.kind).toBe('mission');
    expect(after.logs.some((l) => l.key === (fails ? 'missionFailed' : 'missionSucceeded'))).toBe(true);
    expect(report(pending).logs).toEqual(project(before).logs);
    expect(report(pending).missionResults).toHaveLength(0);
    // Presence updates during gathering/shuffling must not release the report.
    const updated = tablePresentationReducer(pending, {
      type: 'sync', game: { ...after, players: after.players.map((p) => ({ ...p, latency: 42 })) },
    });
    expect(report(updated)).toBe(report(pending));
    expect(report(finish(updated))).toBe(updated.game);
    expect(report(finish(updated)).missionResults).toHaveLength(1);
  });

  it('also holds the winning log and revealed identities on the third failed mission', () => {
    let before = approved();
    for (let round = 0; round < 2; round++)
      before = completeVotes(propose(completeMission(before, 1)), 'approve');
    const after = project(completeMission(before, 1));
    expect(after.phase).toBe('GameOver');
    expect(after.logs.some((l) => l.key === 'evilWinsMissions')).toBe(true);
    const pending = tablePresentationReducer(start(before), { type: 'sync', game: after });
    expect(report(pending).logs).toEqual(project(before).logs);
    expect(report(pending).outcome).toBeNull();
    expect(report(pending).players).toEqual(project(before).players);
    expect(report(finish(pending))).toBe(after);
  });

  it.each([false, true])('keeps a mission hidden behind a queued vote (batched: %s)', (batched) => {
    const before = voting();
    const mission = approved();
    const after = project(completeMission(mission, 1));
    let pending = start(before);
    if (!batched)
      pending = tablePresentationReducer(pending, { type: 'sync', game: project(mission) });
    pending = tablePresentationReducer(pending, { type: 'sync', game: after });
    expect(pending.queue.map((item) => item.presentation.kind)).toEqual(['vote', 'mission']);
    expect(report(pending).logs).toEqual(project(before).logs);
    // A stale or out-of-order callback must not unlock results.
    expect(tablePresentationReducer(pending, {
      type: 'finish', id: pending.queue[1]!.presentation.id,
    })).toBe(pending);
    pending = finish(pending);
    expect(pending.queue[0]?.presentation.kind).toBe('mission');
    expect(report(pending).logs.some((l) => l.key === 'missionFailed')).toBe(false);
    expect(report(pending).missionResults).toHaveLength(0);
    expect(report(finish(pending))).toBe(after);
  });

  it('shows synced history immediately on refresh and clears held reports on rollback/reset', () => {
    const before = approved();
    const after = completeMission(before, 1);
    const refreshed = start(after);
    expect(refreshed.queue).toEqual([]);
    expect(report(refreshed).missionResults).toHaveLength(1);
    const pending = tablePresentationReducer(start(before), { type: 'sync', game: project(after) });
    for (const game of [
      { ...project(before), phaseRevision: 1 },
      { ...project(after), gameId: 'new-game' },
      null,
    ]) {
      const reset = tablePresentationReducer(pending, { type: 'sync', game });
      expect(reset.queue).toEqual([]);
      expect(reset.game).toBe(game);
      expect(tablePresentationReducer(reset, {
        type: 'finish', id: pending.queue[0]!.presentation.id,
      })).toBe(reset);
    }
  });

  it('holds assassination outcome logs until its reveal completes', () => {
    const before = apply(buildStartedGame(FIVE_P), { type: 'START_ASSASSINATION', by: 'p4' });
    const after = project(apply(before, { type: 'ASSASSINATE', by: 'p4', target: 'p0' }));
    const pending = tablePresentationReducer(start(before), { type: 'sync', game: after });
    expect(pending.queue[0]?.presentation.kind).toBe('assassination');
    expect(report(pending).logs.some((l) => l.key === 'assassinHitMerlin')).toBe(false);
    expect(report(finish(pending)).logs.some((l) => l.key === 'assassinHitMerlin')).toBe(true);
  });
});

describe('authoritative action availability', () => {
  it('lets a previously voted player vote again after the referee retracts votes', () => {
    let s = voting();
    s = apply(s, { type: 'CAST_VOTE', by: 'p0', value: 'approve' });
    expect(actionAvailability(project(s), 'p0').canVote).toBe(false);
    s = apply(s, { type: 'RETRACT_VOTES' });
    expect(actionAvailability(project(s), 'p0').canVote).toBe(true);
  });
  it('does not offer another mission card after a fresh projection of an existing submission', () => {
    let s = approved();
    expect(actionAvailability(project(s), 'p0').canMission).toBe(true);
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p0', card: 'success' });
    const refreshed = JSON.parse(JSON.stringify(project(s)));
    expect(actionAvailability(refreshed, 'p0').canMission).toBe(false);
    expect(
      actionAvailability(projectStateForViewer(s, 'spectator'), 'p0')
        .canMission,
    ).toBe(false);
    expect(actionAvailability(project(s), 'p0').canFail).toBe(false);
  });
});

describe('two-ended seating', () => {
  it('keeps all seats in circular order and the viewer at the near edge for 5–10 players', () => {
    for (let count = 5; count <= 10; count++) {
      const players = Array.from({ length: count }, (_, seat) => ({
        id: `p${seat}`,
        seat,
      }));
      for (const viewer of players) {
        const { top, bottom } = arrangeSeats(players, viewer.id);
        expect(bottom[Math.floor((bottom.length - 1) / 2)]?.id).toBe(viewer.id);
        const loop = [...bottom, ...[...top].reverse()];
        expect(new Set(loop.map((p) => p.id)).size).toBe(count);
        expect(
          loop.every(
            (p, i) => loop[(i + 1) % count]!.seat === (p.seat + 1) % count,
          ),
        ).toBe(true);
      }
    }
  });
});
