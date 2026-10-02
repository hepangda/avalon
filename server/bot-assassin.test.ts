import { describe, expect, it } from 'vitest';
import { projectStateForViewer } from '@/lib/engine';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { merlinSuspicions } from './bot-assassin';

function evidence() {
  const state = buildStartedGame(FIVE_P);
  state.phase = 'Assassination';
  state.voteHistory = [{ roundIndex: 0, proposalIndex: 0, leaderId: 'p3', team: ['p0', 'p3'], approved: false,
    votes: { p0: 'reject', p1: 'approve', p2: 'approve', p3: 'approve', p4: 'approve' } }];
  return state;
}

describe('assassin counterfactual reasoning', () => {
  it('has a uniform prior when no player has shown any information', () => {
    const state = evidence(); state.voteHistory = [];
    const suspects = merlinSuspicions(projectStateForViewer(state, 'p4'));
    expect(suspects).toHaveLength(3);
    suspects.forEach((s) => expect(s.probability).toBeCloseTo(1 / 3));
  });

  it('looks for early knowledge that an ordinary player could not explain', () => {
    const suspects = merlinSuspicions(projectStateForViewer(evidence(), 'p4'));
    expect(suspects.find((s) => s.target === 'p0')!.score).toBeGreaterThan(0);
    expect(suspects[0]!.probability).toBeGreaterThan(suspects[1]!.probability);
  });

  it('does not award Merlin evidence for deductions available to everybody', () => {
    const state = evidence();
    state.roundIndex = 1;
    state.voteHistory[0]!.roundIndex = 1;
    state.voteHistory.unshift({ roundIndex: 0, proposalIndex: 0, leaderId: 'p3', team: ['p3', 'p4'], approved: true, votes: {} });
    state.missionResults = [{ roundIndex: 0, teamSize: 2, team: ['p3', 'p4'], success: false, failCount: 2, cards: {} }];
    const suspects = merlinSuspicions(projectStateForViewer(state, 'p4'));
    suspects.forEach((s) => expect(s.probability).toBeCloseTo(1 / 3));
  });

  it('does not give past voters knowledge of later mission results', () => {
    const state = evidence();
    const before = merlinSuspicions(projectStateForViewer(state, 'p4'));
    state.roundIndex = 1;
    state.voteHistory.push({ roundIndex: 1, proposalIndex: 0, leaderId: 'p3', team: ['p3', 'p4'], approved: true, votes: {} });
    state.missionResults = [{ roundIndex: 1, teamSize: 2, team: ['p3', 'p4'], success: false, failCount: 2, cards: {} }];
    expect(merlinSuspicions(projectStateForViewer(state, 'p4'))).toEqual(before);
  });

  it('accounts for Mordred being invisible to Merlin', () => {
    const state = evidence();
    const visibleScore = merlinSuspicions(projectStateForViewer(state, 'p4'))[0]!.score;
    state.players[3]!.role = 'Mordred';
    state.config.roles[3] = 'Mordred';
    const hiddenScore = merlinSuspicions(projectStateForViewer(state, 'p4'))[0]!.score;
    expect(hiddenScore).toBeLessThan(visibleScore);
  });

  it('cannot distinguish secret good roles or inspect another seat’s private logs', () => {
    const state = evidence();
    const before = merlinSuspicions(projectStateForViewer(state, 'p4'));
    state.players[0]!.role = 'LoyalServant'; state.players[2]!.role = 'Merlin';
    state.logs.push({ seq: 1, roundIndex: 0, at: 1, channel: 'private', audience: 'p0', key: 'ladyResultEvil', params: { target: 'p3' } });
    expect(merlinSuspicions(projectStateForViewer(state, 'p4'))).toEqual(before);
  });
});
