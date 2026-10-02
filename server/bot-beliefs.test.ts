import { describe, expect, it } from 'vitest';
import { projectStateForViewer } from '@/lib/engine';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { botBeliefs, failDistribution } from './bot-beliefs';

function history(team: string[], failCount: number, roundIndex = 0) {
  return {
    mission: { roundIndex, teamSize: team.length, team, success: failCount === 0, failCount, cards: {} },
    vote: { roundIndex, proposalIndex: 0, leaderId: 'p0', team, votes: {}, approved: true },
  };
}

describe('bot joint beliefs', () => {
  it('excludes an entire proven failed team even when individual suspects are uncertain', () => {
    const state = buildStartedGame(FIVE_P);
    const record = history(['p1', 'p3'], 1);
    state.missionResults = [record.mission];
    state.voteHistory = [record.vote];
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.risk(['p1', 'p3'])).toBeCloseTo(1);
    expect(model.risk(['p1'])).toBeLessThan(1);
    expect(model.risk(['p3'])).toBeLessThan(1);
  });

  it('uses the fail count and total evil count to clear the remaining players', () => {
    const state = buildStartedGame(FIVE_P);
    const record = history(['p3', 'p4'], 2);
    state.missionResults = [record.mission];
    state.voteHistory = [record.vote];
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.risk(['p0', 'p1', 'p2'])).toBe(0);
    expect(model.risk(['p3'])).toBe(1);
  });

  it('does not condemn innocent teammates when a known evil explains the failure', () => {
    const state = buildStartedGame(FIVE_P);
    const record = history(['p1', 'p3'], 1);
    state.missionResults = [record.mission];
    state.voteHistory = [record.vote];
    state.lastLadyResult = { holderId: 'p2', targetId: 'p3', loyalty: 'evil' };
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    // One fail is also compatible with two reds coordinating. It cannot make
    // the innocent teammate more suspicious than an unrelated unknown seat.
    expect(model.risk(['p1'])).toBeLessThanOrEqual(model.risk(['p0']));
    expect(model.risk(['p1'])).toBeGreaterThan(0);
  });

  it('uses Percival’s pair constraint without pretending to know which is Merlin', () => {
    const state = buildStartedGame(FIVE_P);
    const model = botBeliefs(projectStateForViewer(state, 'p1'), 'p1');
    expect(model.risk(['p0', 'p3'])).toBe(1);
    expect(model.risk(['p0'])).toBeCloseTo(0.5);
    expect(model.risk(['p3'])).toBeCloseTo(0.5);
  });

  it('does not treat a successful mission with one fail as a clean team', () => {
    const state = buildStartedGame(FIVE_P);
    const record = history(['p1', 'p3'], 1, 3);
    record.mission.success = true;
    state.missionResults = [record.mission];
    state.voteHistory = [record.vote];
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.risk(['p1', 'p3'])).toBeCloseTo(1);
    expect(model.risk(['p1', 'p3'], 2)).toBeLessThan(1);
  });

  it('remembers private Lady inspections after another player uses the token', () => {
    const state = buildStartedGame(FIVE_P);
    state.logs = [{ seq: 1, roundIndex: 1, at: 1, channel: 'private', audience: 'p2', key: 'ladyResultEvil', params: { target: 'p3' } }];
    state.lastLadyResult = { holderId: 'p3', targetId: 'p0', loyalty: 'good' };
    const view = projectStateForViewer(state, 'p2');
    expect(view.privateLadyResult).toBeUndefined();
    expect(botBeliefs(view, 'p2').risk(['p3'])).toBeCloseTo(1);
    expect(botBeliefs(view, 'p2', { publicOnly: true }).risk(['p3'])).toBeCloseTo(0.4);
  });

  it('keeps probability mass on hidden red players after successful missions', () => {
    const state = buildStartedGame(FIVE_P);
    const record = history(['p1', 'p3'], 0);
    state.voteHistory = [record.vote];
    state.missionResults = [record.mission];
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.risk(['p1', 'p3'])).toBeGreaterThan(0);
    expect(model.risk(['p1', 'p3'])).toBeLessThan(5 / 6);
    expect(model.distribution(['p0', 'p1', 'p2', 'p3', 'p4'])[2]).toBeCloseTo(1);
  });

  it('handles overlapping mission constraints jointly', () => {
    const state = buildStartedGame(FIVE_P);
    const records = [history(['p2', 'p3'], 1), history(['p2', 'p4'], 1, 1)];
    state.missionResults = records.map((r) => r.mission);
    state.voteHistory = records.map((r) => r.vote);
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.hypothesisCount).toBe(1);
    expect(model.risk(['p0', 'p1', 'p2'])).toBe(0);
  });

  it('cannot turn repeated soft votes into a hard identity fact', () => {
    const state = buildStartedGame(FIVE_P);
    state.voteHistory = Array.from({ length: 30 }, (_, i) => ({ ...history(['p1', 'p3'], 0).vote,
      approved: false, proposalIndex: i % 4, votes: { p0: 'approve', p1: 'approve', p3: 'reject', p4: 'reject' } }));
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.hypothesisCount).toBe(6);
    for (const id of ['p0', 'p1', 'p3', 'p4']) {
      expect(model.risk([id])).toBeGreaterThan(0.1);
      expect(model.risk([id])).toBeLessThan(0.9);
    }
  });

  it('does not use its own votes to reinforce its earlier suspicions', () => {
    const state = buildStartedGame(FIVE_P);
    state.voteHistory = [{ ...history(['p1', 'p3'], 0).vote, approved: false, votes: { p2: 'approve' } }];
    const before = botBeliefs(projectStateForViewer(state, 'p2'), 'p2').risk(['p1']);
    state.voteHistory[0]!.votes.p2 = 'reject';
    expect(botBeliefs(projectStateForViewer(state, 'p2'), 'p2').risk(['p1'])).toBe(before);
  });

  it('reports inconsistent history without NaN or violating the known seat', () => {
    const state = buildStartedGame(FIVE_P);
    const record = history(['p2'], 1);
    state.missionResults = [record.mission]; state.voteHistory = [record.vote];
    const model = botBeliefs(projectStateForViewer(state, 'p2'), 'p2');
    expect(model.consistent).toBe(false);
    expect(model.risk(['p2'])).toBe(0);
    expect(model.risk(['p0'])).toBeCloseTo(0.5);
  });

  it('normalizes mission outcomes and scores useful information', () => {
    const model = botBeliefs(projectStateForViewer(buildStartedGame(FIVE_P), 'p2'), 'p2');
    for (let reds = 0; reds <= 4; reds++) for (const required of [1, 2]) {
      const distribution = failDistribution(reds, required, 0, 0);
      expect(distribution.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
      expect(distribution.every((p) => p > 0)).toBe(true);
    }
    expect(model.outcomes(['p2']).information).toBeCloseTo(0);
    expect(model.outcomes(['p2', 'p3']).information).toBeGreaterThan(0);
    expect(model.inspectionValue('p2', 2)).toBe(0);
    expect(model.inspectionValue('p3', 2)).toBeGreaterThan(0);
  });
});
