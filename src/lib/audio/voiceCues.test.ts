import { describe, expect, it } from 'vitest';
import { projectStateForViewer, reduce, createRng, type GameState, type GameEvent } from '@/lib/engine';
import { buildStartedGame, FIVE_P, proposeForVote } from '@/lib/engine/testkit';
import { completeMission, completeVotes } from '@/lib/debug/scenarios';
import { voiceCues } from './voiceCues';

const project = (state: GameState) => projectStateForViewer(state, 'p0');
function apply(state: GameState, event: GameEvent) {
  const result = reduce(state, event, { now: 1, rng: createRng('voices') });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

describe('public game narration', () => {
  it('does not replay on arrival, repeated snapshots, new games or rollbacks', () => {
    const game = project(buildStartedGame(FIVE_P));
    expect(voiceCues(null, game)).toEqual([]);
    expect(voiceCues(game, { ...game })).toEqual([]);
    expect(voiceCues(game, { ...game, gameId: 'another', phase: 'Voting' })).toEqual([]);
    expect(voiceCues(game, { ...game, phaseRevision: 1, phase: 'Voting' })).toEqual([]);
  });
  it.each(['approve', 'reject'] as const)('announces a completed %s vote before the next instruction', (value) => {
    let state = proposeForVote(buildStartedGame(FIVE_P), { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p3'] });
    const before = project(state);
    for (const player of state.players) state = apply(state, { type: 'CAST_VOTE', by: player.id, value });
    expect(voiceCues(before, project(state))).toEqual(value === 'approve'
      ? ['voteApproved', 'missionVote'] : ['voteRejected', 'teamBuilding']);
  });
  it('announces the public winner without disclosing identities', () => {
    const state = apply(buildStartedGame(FIVE_P), { type: 'START_ASSASSINATION', by: 'p4' });
    const end = apply(state, { type: 'ASSASSINATE', by: 'p4', target: 'p0' });
    expect(voiceCues(project(state), project(end))).toEqual(['evilWins']);
  });
  it.each([['p0', 'evilWins'], ['p1', 'goodWins']] as const)(
    'drops accumulated vote and mission results when assassination targets %s', (target, winner) => {
      const voting = proposeForVote(buildStartedGame(FIVE_P), { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p3'] });
      const mission = completeMission(completeVotes(voting, 'approve'), 0);
      const assassination = apply(mission, { type: 'START_ASSASSINATION', by: 'p4' });
      const end = apply(assassination, { type: 'ASSASSINATE', by: 'p4', target });
      const before = project(voting);
      expect(project(end).voteHistory.length).toBeGreaterThan(before.voteHistory.length);
      expect(project(end).missionResults.length).toBeGreaterThan(before.missionResults.length);
      expect(voiceCues(before, project(assassination))).toEqual(['assassination']);
      expect(voiceCues(before, project(end))).toEqual([winner]);
      expect(voiceCues(project(end), project(end))).toEqual([]);
    },
  );
  it('uses seat numbers rather than speaking order or player array position', () => {
    const before = project(buildStartedGame(FIVE_P));
    const next = { ...before, phase: 'Discussion' as const,
      players: [...before.players].reverse().map((p) => p.id === 'p0' ? { ...p, seat: 9 } : p),
      discussion: { order: ['p0', 'p1'], speakerIndex: 0 },
    };
    expect(voiceCues(before, next)).toEqual(['discussion10']);
    expect(voiceCues(before, { ...next, discussion: { order: ['missing'], speakerIndex: 0 } })).toEqual([]);
  });
  it('announces each new speaker, but not their timer updates', () => {
    const game = project(buildStartedGame(FIVE_P));
    const previous = { ...game, phase: 'Discussion' as const, discussion: { order: ['p0', 'p1'], speakerIndex: 0 } };
    const next = { ...previous, discussion: { ...previous.discussion, speakerIndex: 1 } };
    expect(voiceCues(previous, next)).toEqual(['discussion2']);
    expect(voiceCues(next, { ...next, serverTime: 99 })).toEqual([]);
  });
});
