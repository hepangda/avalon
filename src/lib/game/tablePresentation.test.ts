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
  endingRevealOrder,
  endingTimeline,
  missionRevealTimeline,
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
      // The identities follow the dagger; the assassination itself announced the winner.
      expect(events.map((e) => e.kind)).toEqual(['assassination', 'gameOver']);
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

  it('plays other endings without inventing an assassination', () => {
    const before = project(buildStartedGame(FIVE_P));
    const after = {
      ...before,
      phase: 'GameOver' as const,
      outcome: { winner: 'evil' as const, reason: 'five_rejections' as const, missionTally: { good: 0, evil: 0 }, revealedRoles: [] },
    };
    const events = newTablePresentations(before, after);
    expect(events.map((e) => e.kind)).toEqual(['gameOver']);
    expect(events[0]).toMatchObject({ outcome: { reason: 'five_rejections' } });
    // Only the step into GameOver plays it: never an ending already over, a refresh or a late join.
    expect(newTablePresentations(after, after)).toEqual([]);
    expect(newTablePresentations(null, after)).toEqual([]);
    expect(newTablePresentations(before, { ...after, phaseRevision: 1 })).toEqual([]);
  });

  it('turns red seats first, then blue, and Merlin last', () => {
    let s = approved();
    for (let round = 0; round < 2; round++)
      s = completeVotes(propose(completeMission(s, 1)), 'approve');
    const over = project(completeMission(s, 1));
    const order = endingRevealOrder(over);
    const roleOf = (id: string) => over.outcome!.revealedRoles.find((r) => r.playerId === id)!;
    expect(order).toHaveLength(over.players.length);
    expect(new Set(order).size).toBe(order.length);
    expect(roleOf(order.at(-1)!).role).toBe('Merlin');
    const teams = order.map((id) => roleOf(id).team);
    expect(teams.indexOf('good')).toBe(teams.lastIndexOf('evil') + 1);
    const evilSeats = order.filter((id) => roleOf(id).team === 'evil').map((id) => over.players.find((p) => p.id === id)!.seat);
    expect(evilSeats).toEqual([...evilSeats].sort((a, b) => a - b));
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

  it('queues the ending after the deciding mission and never replays it on refresh', () => {
    let before = approved();
    for (let round = 0; round < 2; round++)
      before = completeVotes(propose(completeMission(before, 1)), 'approve');
    const after = project(completeMission(before, 1));
    let pending = tablePresentationReducer(start(before), { type: 'sync', game: after });
    expect(pending.queue.map((item) => item.presentation.kind)).toEqual(['mission', 'gameOver']);
    pending = finish(pending);
    expect(pending.queue[0]?.presentation).toMatchObject({ kind: 'gameOver', outcome: { winner: 'evil', reason: 'three_missions' } });
    // Later syncs of the finished game add nothing, before or after the ending plays.
    expect(tablePresentationReducer(pending, { type: 'sync', game: { ...after } }).queue).toHaveLength(1);
    const done = finish(pending);
    expect(done.queue).toEqual([]);
    expect(report(done)).toBe(after);
    expect(tablePresentationReducer(done, { type: 'sync', game: { ...after } }).queue).toEqual([]);
    // A refresh or a late joiner starts at the finished table.
    expect(start(completeMission(before, 1)).queue).toEqual([]);
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
    // ...through the mission, and on until the ending has turned every seat.
    expect(report(finish(pending)).outcome).toBeNull();
    expect(report(finish(finish(pending)))).toBe(after);
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
    expect(finish(pending).queue[0]?.presentation.kind).toBe('gameOver');
    expect(report(finish(finish(pending))).logs.some((l) => l.key === 'assassinHitMerlin')).toBe(true);
  });
});

describe('reveal pacing', () => {
  it('turns mission cards one at a time, each wait longer and the last longest', () => {
    for (let size = 2; size <= 5; size++) {
      const { flips, verdict, seal, complete } = missionRevealTimeline(size);
      expect(flips).toHaveLength(size);
      const gaps = flips.slice(1).map((ms, i) => ms - flips[i]!);
      gaps.forEach((gap, i) => i && expect(gap).toBeGreaterThan(gaps[i - 1]!));
      expect(verdict).toBeGreaterThan(flips.at(-1)!);
      expect(seal).toBeGreaterThan(verdict);
      expect(complete).toBeGreaterThan(seal);
    }
    expect(missionRevealTimeline(3, true)).toMatchObject({ flips: [], complete: 1800 });
  });

  it('pauses before blue turns and longest before Merlin; reduced motion goes straight to the end', () => {
    const outcome = {
      winner: 'evil' as const, reason: 'three_missions' as const, missionTally: { good: 0, evil: 3 },
      revealedRoles: [
        { playerId: 'a', role: 'Morgana' as const, team: 'evil' as const },
        { playerId: 'b', role: 'Assassin' as const, team: 'evil' as const },
        { playerId: 'c', role: 'Percival' as const, team: 'good' as const },
        { playerId: 'd', role: 'LoyalServant' as const, team: 'good' as const },
        { playerId: 'e', role: 'Merlin' as const, team: 'good' as const },
      ],
    };
    const { flips, settle } = endingTimeline({ outcome, order: ['a', 'b', 'c', 'd', 'e'] });
    const gaps = flips.slice(1).map((ms, i) => ms - flips[i]!);
    expect(gaps[1]).toBeGreaterThan(gaps[0]!);
    expect(gaps[3]).toBeGreaterThan(gaps[1]!);
    expect(Math.max(...gaps)).toBe(gaps[3]);
    expect(settle).toBeGreaterThan(flips.at(-1)!);
    expect(endingTimeline({ outcome, order: [] }, true)).toMatchObject({ flips: [], settle: 0 });
    expect(endingTimeline({ outcome: { ...outcome, reason: 'assassin_missed' }, order: [] }, true).title).toBe(0);
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
