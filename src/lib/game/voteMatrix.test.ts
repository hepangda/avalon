import { describe, expect, it } from 'vitest';
import { buildScenario } from '@/lib/debug/scenarios';
import { projectStateForViewer, type ClientLogEntry } from '@/lib/engine';
import { foldLog } from './foldLog';
import { buildVoteMatrix } from './voteMatrix';

describe('vote matrix', () => {
  const scene = buildScenario('voteSheet', 10);
  const game = projectStateForViewer(scene.state, scene.viewerId);
  const rounds = buildVoteMatrix(game);

  it('groups every nomination under its mission, closed by the result', () => {
    expect(rounds.map((r) => r.roundIndex)).toEqual([0, 1, 2, 3]);
    expect(rounds.map((r) => r.proposals.length)).toEqual([2, 2, 3, 1]);
    expect(rounds.map((r) => r.result?.success ?? null)).toEqual([true, false, true, null]);
    for (const round of rounds.slice(0, 3)) {
      expect(round.proposals.map((p) => p.approved)).toEqual([...round.proposals.slice(1).map(() => false), true]);
      for (const p of round.proposals) expect(p.votes?.size).toBe(10);
    }
  });

  it('keeps each seat\'s own vote, team and leader', () => {
    const first = rounds[0]!.proposals[0]!;
    const record = game.voteHistory[0]!;
    expect(first.leaderId).toBe(record.leaderId);
    expect(first.team).toEqual(record.team);
    for (const { playerId, vote } of record.votes) expect(first.votes?.get(playerId)).toBe(vote);
  });

  it('ends with the proposal still on the table, without votes', () => {
    const open = rounds.at(-1)!.proposals.at(-1)!;
    expect(open).toMatchObject({ approved: null, votes: null, team: game.proposedTeam });
    expect(open.leaderId).toBe(game.players.find((p) => p.seat === game.leaderIndex)!.id);
  });

  it('has nothing left open once the game is over', () => {
    const over = buildScenario('goodWins', 10);
    const done = buildVoteMatrix(projectStateForViewer(over.state, over.viewerId));
    expect(done.flatMap((r) => r.proposals).every((p) => p.votes)).toBe(true);
  });
});

describe('folded discussion lines', () => {
  const entry = (seq: number, key: string): ClientLogEntry =>
    ({ seq, key, at: seq, roundIndex: 0, channel: 'public' }) as ClientLogEntry;

  it('turns each run of speaking turns into one entry', () => {
    const items = foldLog([
      entry(1, 'teamAnnounced'),
      entry(2, 'speechBegins'),
      entry(3, 'speechBegins'),
      entry(4, 'admin.speechSkipped'),
      entry(5, 'speechBegins'),
      entry(6, 'discussionFinished'),
      entry(7, 'speechBegins'),
    ]);
    expect(items.map((i) => i.kind === 'entry' ? i.entry.key : i.entries.map((e) => e.seq))).toEqual([
      'teamAnnounced', [2, 3, 4, 5], 'discussionFinished', [7],
    ]);
  });

  it('folds every discussion in a real game', () => {
    const scene = buildScenario('voteSheet', 7);
    const logs = projectStateForViewer(scene.state, scene.viewerId).logs.filter((l) => l.channel === 'public');
    const items = foldLog(logs);
    expect(items.some((i) => i.kind === 'entry' && i.entry.key === 'speechBegins')).toBe(false);
    expect(items.filter((i) => i.kind === 'speeches').length).toBeGreaterThan(1);
  });
});
