import { describe, expect, it } from 'vitest';
import { buildScenario } from '@/lib/debug/scenarios';
import { projectStateForViewer, type ClientLogEntry } from '@/lib/engine';
import { chronicle, type ProposalChapter } from './foldLog';

describe('the chronicle', () => {
  const entry = (seq: number, key: string, params?: Record<string, string>, style?: 'admin'): ClientLogEntry =>
    ({ seq, key, params, style, at: seq, roundIndex: 0, channel: 'public' }) as ClientLogEntry;

  it('gathers one nomination into a single chapter that ends with its quest', () => {
    const items = chronicle([
      entry(1, 'gameStarted'),
      entry(2, 'roundBegins', { round: '1' }),
      entry(3, 'proposalBegins', { round: '1', proposal: '1', leader: 'p1' }),
      entry(4, 'teamAnnounced', { leader: 'p1', team: 'p1,p2' }),
      entry(5, 'speechBegins', { player: 'p2' }),
      entry(6, 'discussionFinished', { leader: 'p1' }),
      entry(7, 'teamFinalized', { leader: 'p1', team: 'p1,p3' }),
      entry(8, 'voteApproved', { round: '1', proposal: '1' }),
      entry(9, 'missionFailed', { round: '1', fails: '1' }),
      entry(10, 'ladyBegins', { holder: 'p4' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['entry', 'round', 'proposal', 'entry']);
    const chapter = items[2] as ProposalChapter;
    expect(chapter).toMatchObject({ round: 1, proposal: 1, leader: 'p1', draft: ['p1', 'p2'], team: ['p1', 'p3'] });
    expect([chapter.speeches.length, chapter.vote?.seq, chapter.mission?.seq]).toEqual([1, 8, 9]);
  });

  it('keeps no draft when the final team is the announced one', () => {
    const [chapter] = chronicle([
      entry(1, 'proposalBegins', { round: '1', proposal: '1', leader: 'p1' }),
      entry(2, 'teamAnnounced', { leader: 'p1', team: 'p1,p2' }),
      entry(3, 'teamFinalized', { leader: 'p1', team: 'p2,p1' }),
    ]) as [ProposalChapter];
    expect([chapter.draft, chapter.team]).toEqual([null, ['p2', 'p1']]);
  });

  it('keeps referee lines inside the nomination and clears a retracted team', () => {
    const [chapter] = chronicle([
      entry(1, 'proposalBegins', { round: '1', proposal: '1', leader: 'p1' }),
      entry(2, 'teamFinalized', { leader: 'p1', team: 'p1,p2' }),
      entry(3, 'admin.proposalRetracted', { actor: 'x' }, 'admin'),
    ]) as [ProposalChapter];
    expect([chapter.team, chapter.notes.map((n) => n.seq)]).toEqual([[], [3]]);
  });

  it('turns every nomination of a real game into a chapter', () => {
    const scene = buildScenario('voteSheet', 7);
    const state = projectStateForViewer(scene.state, scene.viewerId);
    const chapters = chronicle(state.logs.filter((l) => l.channel === 'public'))
      .filter((i): i is ProposalChapter => i.kind === 'proposal');
    expect(chapters.filter((c) => c.vote).length).toBe(state.voteHistory.length);
    expect(chapters.filter((c) => c.mission).length).toBe(state.missionResults.length);
  });
});
