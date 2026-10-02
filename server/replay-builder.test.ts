import { describe, expect, it } from 'vitest';
import {
  createGame,
  createRng,
  currentMissionSize,
  leaderId,
  projectStateForViewer,
  reduce,
  type GameEvent,
} from '@/lib/engine';
import { DEFAULT_OPTIONS } from '@/lib/engine/testkit';
import { buildReplayFromEvents } from './replay-builder';

describe('replays with referee rollback', () => {
  it('records both minion appearances in the replay', () => {
    const players = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const replay = buildReplayFromEvents('minion-art', 'minion-art', DEFAULT_OPTIONS, players, [
      { seq: 1, event: { type: 'START_GAME', by: 'p0', flowVersion: 4 }, createdAt: 1 },
    ]);
    expect(replay).not.toBeNull();
    expect(replay!.roleAssignments.filter((p) => p.role === 'Minion')
      .map((p) => p.roleVariant).sort()).toEqual([0, 1]);
  });

  it('can still replay pre-discussion event logs without a flow version', () => {
    const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const created = createGame({ hostId: 'p0', players, options: DEFAULT_OPTIONS, seed: 'legacy' });
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    const events: Array<{ seq: number; event: GameEvent; createdAt: number }> = [];
    const apply = (event: GameEvent) => {
      const result = reduce(state, event, { now: events.length + 1, rng: createRng('legacy') });
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      events.push({ seq: events.length + 1, event: event.type === 'START_GAME' ? { type: 'START_GAME', by: event.by } : event, createdAt: events.length + 1 });
    };
    apply({ type: 'START_GAME', by: 'p0', flowVersion: 1 });
    for (let i = 0; i < 5; i++) {
      apply({ type: 'PROPOSE_TEAM', by: leaderId(state), team: ['p0', 'p1'] });
      for (const p of players) apply({ type: 'CAST_VOTE', by: p.id, value: 'reject' });
    }
    expect(buildReplayFromEvents('legacy-game', 'legacy', DEFAULT_OPTIONS, players, events)?.outcome).toEqual(state.outcome);
  });
  it('excludes abandoned votes, mission results and Lady checks from the final replay', () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
    }));
    const options = { ...DEFAULT_OPTIONS, ladyOfTheLake: true };
    const seed = 'replay-referee';
    const created = createGame({ hostId: 'p0', players, options, seed });
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    const events: Array<{ seq: number; event: GameEvent; createdAt: number }> = [];
    const apply = (event: GameEvent) => {
      const seq = events.length + 1;
      const result = reduce(state, event, {
        now: seq,
        rng: createRng(`${seed}:${seq}`),
      });
      if (!result.ok) throw new Error(result.error.message);
      events.push({ seq, event, createdAt: seq });
      state = result.state;
    };
    const propose = (team: string[]) => {
      const by = leaderId(state);
      apply({ type: 'PROPOSE_TEAM', by, team });
      for (const speaker of state.discussion!.order) apply({ type: 'END_SPEECH', by: speaker });
      apply({ type: 'FINALIZE_TEAM', by, team });
    };
    const vote = (value: 'approve' | 'reject') => {
      for (const p of players) apply({ type: 'CAST_VOTE', by: p.id, value });
    };
    const mission = () => {
      const team = players.slice(0, currentMissionSize(state)).map((p) => p.id);
      propose(team);
      vote('approve');
      for (const by of team) apply({ type: 'CAST_MISSION_CARD', by, card: 'success' });
    };
    const back: GameEvent = { type: 'PREVIOUS_PHASE', actor: 'Referee' };
    apply({ type: 'START_GAME', by: 'p0', flowVersion: 4 });
    propose(['p0', 'p1']);
    vote('reject');
    apply(back);
    vote('approve');
    for (const by of ['p0', 'p1']) apply({ type: 'CAST_MISSION_CARD', by, card: 'success' });
    mission();
    const holder = state.ladyHolderId!;
    const target = players.find((p) => p.id !== holder)!.id;
    apply({ type: 'USE_LADY', by: holder, target });
    apply(back); // undo the Lady inspection
    apply(back); // undo the second mission result
    const assassin = state.assassinId!;
    apply({
      type: 'START_ASSASSINATION',
      by: assassin,
      admin: true,
      actor: 'Referee',
    });
    apply({
      type: 'ASSASSINATE',
      by: assassin,
      target: state.players.find((p) => p.role === 'Merlin')!.id,
    });
    const replay = buildReplayFromEvents('game-id', seed, options, players, events)!;
    expect(replay.outcome).toEqual(state.outcome);
    const finalPlayers = projectStateForViewer(state, 'spectator').players;
    for (const assignment of replay.roleAssignments) {
      expect(assignment.roleVariant).toBe(
        finalPlayers.find((player) => player.id === assignment.playerId)?.roleVariant,
      );
    }
    expect(replay.ladyChecks).toEqual([]);
    expect(replay.rounds[0]!.votes).toHaveLength(5); // includes the last deciding vote
    expect(replay.rounds[0]!.votes.every((v) => v.value === 'approve')).toBe(true);
    expect(replay.rounds[0]!.missionCards).toHaveLength(2);
    expect(replay.rounds[1]!.missionSuccess).toBeNull();
    expect(replay.rounds[1]!.missionCards).toEqual([]);
  });
});
