import { describe, expect, it } from 'vitest';
import { buildScenario } from '@/lib/debug/scenarios';
import { createGame, createRng, projectStateForViewer, reduce, type ClientGameState, type GameEvent, type GameState } from '@/lib/engine';
import { DEFAULT_OPTIONS, FIVE_P, proposeForVote } from '@/lib/engine/testkit';
import { byQuest, chronicle, type ProposalChapter } from './foldLog';

const step = (s: GameState, event: GameEvent) => {
  const result = reduce(s, event, { now: 1, rng: createRng('fold') });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const started = () => {
  const created = createGame({
    hostId: 'p0', players: FIVE_P.map((_, i) => ({ id: `p${i}`, name: `P${i}` })), options: DEFAULT_OPTIONS, seed: 'fold',
  });
  if (!created.ok) throw new Error(created.error.message);
  return step(created.state, { type: 'START_GAME', by: 'p0' });
};
const leaderOf = (s: GameState) => s.players[s.leaderIndex]!.id;
const vote = (s: GameState, value: 'approve' | 'reject') =>
  s.players.reduce((next, p) => step(next, { type: 'CAST_VOTE', by: p.id, value }), s);
const quest = (s: GameState, fail: string | null = null) =>
  (s.proposedTeam ?? []).reduce((next, by) => step(next, { type: 'CAST_MISSION_CARD', by, card: by === fail ? 'fail' : 'success' }), s);
const back = (s: GameState) => step(s, { type: 'PREVIOUS_PHASE', actor: 'Referee' });
const view = (s: GameState): ClientGameState => projectStateForViewer(s, 'p0');
const render = (s: GameState) => {
  const game = view(s);
  return chronicle(game.logs.filter((l) => l.channel === 'public'), game);
};
const shape = (s: GameState) => render(s).map((i) =>
  i.kind === 'entry' ? i.entry.key : i.kind === 'round' ? `round ${i.entry.params?.round}` : `card ${i.key}`);
const quests = (s: GameState) => byQuest(render(s)).map((i) =>
  i.kind === 'entry' ? i.entry.key : `quest ${i.round}: ${i.body.map((b) => b.kind === 'proposal' ? b.key : b.entry.key).join(' ')}`);
const cards = (s: GameState) => render(s).filter((i): i is ProposalChapter => i.kind === 'proposal');

describe('the chronicle', () => {
  it('draws each nomination from the history, with the draft its leader later changed', () => {
    let s = started();
    s = vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p0', 'p1'] }), 'reject');
    const leader = leaderOf(s);
    s = step(s, { type: 'PROPOSE_TEAM', by: leader, team: ['p1', 'p2'] });
    s = step(s, { type: 'START_DISCUSSION', by: leader });
    for (const by of s.discussion!.order) s = step(s, { type: 'END_SPEECH', by });
    s = quest(vote(step(s, { type: 'FINALIZE_TEAM', by: leader, team: ['p1', 'p3'] }), 'approve'), 'p3');
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'card 1-1', 'card 1-2', 'round 2', 'card 2-1']);
    const [, second, live] = cards(s);
    expect(second).toMatchObject({ leader, draft: ['p1', 'p2'], team: ['p1', 'p3'], live: false });
    expect([second!.speeches.length, second!.record?.approved, second!.mission?.success]).toEqual([5, true, false]);
    expect(live).toMatchObject({ round: 2, proposal: 1, leader: leaderOf(s), team: [], live: true });
  });

  it('reads a rerolled opening as a new game, with the reroll noted only until play begins', () => {
    let s = started();
    s = step(s, { type: 'REROLL_LEADER', actor: 'Referee' });
    s = step(s, { type: 'REROLL_ROLES', actor: 'Referee' });
    s = step(s, { type: 'USE_REROLL_CARD', by: 'p2', roleRevision: s.roleRevision ?? 0 });
    const leader = leaderOf(s);
    expect(shape(s)).toEqual([
      'gameStarted', 'lineup', 'round 1',
      'admin.leaderRerolled', 'admin.rolesRerolled', 'rerollCardUsed',
      'card 1-1',
    ]);
    s = vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leader, team: ['p0', 'p1'] }), 'reject');
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'card 1-1', 'card 1-2']);
    expect(cards(s)[0]).toMatchObject({ leader, team: ['p0', 'p1'] });
    expect(cards(s)[0]!.speeches).toHaveLength(5);
  });

  it('shows a nomination a referee rewound into once, as history now has it', () => {
    let s = started();
    s = vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p0', 'p1'] }), 'reject');
    s = back(s);
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'admin.phaseReturned', 'card 1-1']);
    expect(cards(s)[0]).toMatchObject({ team: ['p0', 'p1'], live: true, record: undefined });
    s = vote(s, 'approve');
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'admin.phaseReturned', 'card 1-1']);
    expect(cards(s)[0]!.record?.approved).toBe(true);
  });

  it('keeps a rewound quest on its own card and heads the next quest once', () => {
    let s = started();
    s = quest(vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p0', 'p1'] }), 'approve'));
    s = back(s);
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'card 1-1', 'admin.phaseReturned']);
    expect(cards(s)[0]!.mission).toBeUndefined();
    s = quest(s, 'p1');
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'card 1-1', 'admin.phaseReturned', 'round 2', 'card 2-1']);
    expect(cards(s)[0]!.mission?.success).toBe(false);
  });

  it('carries on the nomination in play when a referee steps it back', () => {
    let s = started();
    s = back(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p0', 'p1'] }));
    s = vote(step(s, { type: 'FINALIZE_TEAM', by: leaderOf(s), team: ['p0', 'p2'] }), 'approve');
    expect(shape(s)).toEqual(['gameStarted', 'lineup', 'round 1', 'admin.phaseReturned', 'card 1-1']);
    expect(cards(s)[0]).toMatchObject({ draft: ['p0', 'p1'], team: ['p0', 'p2'] });
  });

  it('turns every nomination of a real game into a card', () => {
    const scene = buildScenario('voteSheet', 7);
    const state = projectStateForViewer(scene.state, scene.viewerId);
    const all = chronicle(state.logs.filter((l) => l.channel === 'public'), state)
      .filter((i): i is ProposalChapter => i.kind === 'proposal');
    expect(all.filter((c) => c.record).length).toBe(state.voteHistory.length);
    expect(all.filter((c) => c.mission).length).toBe(state.missionResults.length);
  });

  it('gathers each quest onto one card, lines before and after its nominations standing outside it', () => {
    let s = started();
    s = step(s, { type: 'SET_TIMERS_PAUSED', paused: true, actor: 'Referee' });
    for (let i = 0; i < 5; i++) s = vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p0', 'p1'] }), 'reject');
    expect(quests(s)).toEqual(['gameStarted', 'lineup', 'admin.timersPaused', 'quest 1: 1-1 1-2 1-3 1-4 1-5', 'hammerEvilWins']);
  });

  it("keeps a referee's line told between two nominations inside the quest", () => {
    let s = started();
    s = vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p0', 'p1'] }), 'reject');
    s = step(s, { type: 'SET_TIMERS_PAUSED', paused: true, actor: 'Referee' });
    s = vote(proposeForVote(s, { type: 'PROPOSE_TEAM', by: leaderOf(s), team: ['p1', 'p2'] }), 'reject');
    expect(quests(s)).toEqual(['gameStarted', 'lineup', 'quest 1: 1-1 admin.timersPaused 1-2 1-3']);
  });
});
