import { describe, expect, it } from 'vitest';
import { createRng, projectStateForViewer, reduce, type GameEvent, type GameState } from './index';
import { buildStartedGame, FIVE_P } from './testkit';

const ctx = { now: 1000, rng: createRng('consent') };
function apply(s: GameState, event: GameEvent) {
  const result = reduce(s, event, ctx);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
const request = (s: GameState, by = 'p3') => apply(s, { type: 'REQUEST_ASSASSINATION', by });
const vote = (s: GameState, by: string, value: 'approve' | 'reject' = 'approve') =>
  apply(s, { type: 'VOTE_ASSASSINATION', by, proposalId: s.earlyAssassination!.id, value });
const roles = [...FIVE_P, 'Mordred', 'Oberon'] as const;

describe('private early assassination consent', () => {
  it.each(['p3', 'p4', 'p5'])('lets known red teammate %s initiate and requires every ally, including offline allies', (by) => {
    const before = buildStartedGame([...roles]);
    before.players[5]!.connected = false;
    let state = request(before, by);
    expect(before.earlyAssassination).toBeUndefined();
    expect(state.earlyAssassination).toMatchObject({ initiatorId: by, voterIds: ['p3', 'p4', 'p5'], votes: { [by]: 'approve' } });
    const remaining = ['p3', 'p4', 'p5'].filter((id) => id !== by);
    state = vote(state, remaining[0]!);
    expect(state.phase).toBe('TeamBuilding');
    state = vote(state, remaining[1]!);
    expect(state.phase).toBe('Assassination');
    expect(state.earlyAssassination).toBeNull();
    expect(state.logs.at(-1)?.key).toBe('earlyAssassination');
  });

  it('excludes good, Oberon and spectators from requesting, seeing and voting on the ballot', () => {
    const before = apply(buildStartedGame([...roles]), { type: 'SET_CONNECTED', by: 'p0', connected: true });
    const state = request(before);
    for (const by of ['p0', 'p1', 'p2', 'p6', 'spectator']) {
      expect(reduce(before, { type: 'REQUEST_ASSASSINATION', by }, ctx).ok).toBe(false);
      expect(reduce(state, { type: 'VOTE_ASSASSINATION', by, proposalId: state.earlyAssassination!.id, value: 'approve' }, ctx).ok).toBe(false);
      expect(projectStateForViewer(state, by)).toEqual(projectStateForViewer(before, by));
    }
    expect(projectStateForViewer(state, 'p4').earlyAssassination).toEqual(state.earlyAssassination);
    expect(projectStateForViewer(state, 'p4').canStartAssassination).toBe(false);
  });

  it('rejects duplicate, invalid and stale votes; a rejection preserves the current quest', () => {
    const before = buildStartedGame(FIVE_P);
    before.phase = 'MissionVote'; before.proposedTeam = ['p0', 'p3']; before.missionCards = { p3: 'fail' };
    const pending = request(before);
    const proposalId = pending.earlyAssassination!.id;
    expect(reduce(pending, { type: 'REQUEST_ASSASSINATION', by: 'p4' }, ctx).ok).toBe(false);
    expect(reduce(pending, { type: 'VOTE_ASSASSINATION', by: 'p3', proposalId, value: 'approve' }, ctx).ok).toBe(false);
    expect(reduce(pending, { type: 'VOTE_ASSASSINATION', by: 'p4', proposalId, value: 'bad' as 'approve' }, ctx).ok).toBe(false);
    const rejected = vote(pending, 'p4', 'reject');
    expect(rejected.phase).toBe(before.phase);
    expect(rejected.missionCards).toEqual(before.missionCards);
    expect(rejected.proposedTeam).toEqual(before.proposedTeam);
    expect(rejected.earlyAssassination).toBeNull();
    const retry = request(rejected);
    expect(retry.earlyAssassination!.id).toBeGreaterThan(proposalId);
    expect(reduce(retry, { type: 'VOTE_ASSASSINATION', by: 'p4', proposalId, value: 'approve' }, ctx).ok).toBe(false);
    const approved = vote(retry, 'p4');
    expect(approved.missionCards).toEqual({});
    expect(approved.proposedTeam).toBeNull();
  });

  it('keeps the ballot through ordinary play and reconnects but clears it on redeal and rollback', () => {
    let state = request(buildStartedGame(FIVE_P));
    const ballot = structuredClone(state.earlyAssassination);
    state = apply(state, { type: 'SET_CONNECTED', by: 'p4', connected: false });
    state = apply(state, { type: 'SET_CONNECTED', by: 'p4', connected: true });
    expect(state.earlyAssassination).toEqual(ballot);
    const redealt = apply(state, { type: 'REROLL_ROLES', actor: 'referee', assignedRoles: FIVE_P });
    expect(redealt.earlyAssassination).toBeNull();
    state = apply(state, { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] });
    expect(state.earlyAssassination).toEqual(ballot);
    expect(apply(state, { type: 'PREVIOUS_PHASE', actor: 'referee' }).earlyAssassination).toBeNull();
  });

  it('clears consent on natural game completion or referee assassination', () => {
    let state = buildStartedGame(FIVE_P);
    state.phase = 'MissionVote'; state.proposedTeam = ['p0', 'p1']; state.missionCards = { p0: 'success' };
    state.missionResults = [0, 1].map((roundIndex) => ({ roundIndex, teamSize: 2, team: ['p0', 'p1'], success: true, failCount: 0, cards: {} }));
    state = request(state);
    const natural = apply(state, { type: 'CAST_MISSION_CARD', by: 'p1', card: 'success' });
    expect(natural.phase).toBe('Assassination');
    expect(natural.earlyAssassination).toBeNull();
    const admin = apply(state, { type: 'START_ASSASSINATION', by: 'p0', admin: true });
    expect(admin.phase).toBe('Assassination');
    expect(admin.earlyAssassination).toBeNull();
  });
});
