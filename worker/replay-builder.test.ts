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
    const vote = (value: 'approve' | 'reject') => {
      for (const p of players) apply({ type: 'CAST_VOTE', by: p.id, value });
    };
    const mission = () => {
      const team = players.slice(0, currentMissionSize(state)).map((p) => p.id);
      apply({ type: 'PROPOSE_TEAM', by: leaderId(state), team });
      vote('approve');
      for (const by of team) apply({ type: 'CAST_MISSION_CARD', by, card: 'success' });
    };
    const back: GameEvent = { type: 'PREVIOUS_PHASE', actor: 'Referee' };
    apply({ type: 'START_GAME', by: 'p0' });
    apply({ type: 'PROPOSE_TEAM', by: leaderId(state), team: ['p0', 'p1'] });
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
