import { describe, it, expect } from 'vitest';
import { decideCue } from './cueLogic';

const vote = (approved: boolean, roundIndex = 0) => ({ approved, roundIndex });
const mission = (success: boolean, roundIndex = 0) => ({ success, roundIndex });

describe('decideCue — result cue decision', () => {
  it('first observation (prev null) fires nothing, sets baseline', () => {
    const r = decideCue(null, {
      voteHistory: [vote(true), vote(false)],
      missionResults: [mission(true)],
    });
    expect(r.cue).toBeNull();
    expect(r.next).toEqual({ votes: 2, missions: 1 });
  });

  it('does NOT replay cues on reconnect (full history arrives at once)', () => {
    const r = decideCue(null, {
      voteHistory: [vote(true), vote(false), vote(true)],
      missionResults: [mission(true), mission(false)],
    });
    expect(r.cue).toBeNull();
  });

  it('fires voteApproved with the round index when an approved vote is appended', () => {
    const r = decideCue(
      { votes: 1, missions: 0 },
      { voteHistory: [vote(false, 0), vote(true, 0)], missionResults: [] },
    );
    expect(r.cue).toEqual({ kind: 'voteApproved', roundIndex: 0 });
    expect(r.next).toEqual({ votes: 2, missions: 0 });
  });

  it('fires voteRejected when a rejected vote is appended', () => {
    const r = decideCue(
      { votes: 0, missions: 0 },
      { voteHistory: [vote(false, 2)], missionResults: [] },
    );
    expect(r.cue).toEqual({ kind: 'voteRejected', roundIndex: 2 });
  });

  it('fires missionSuccess with the round index when a successful mission is appended', () => {
    const r = decideCue(
      { votes: 2, missions: 0 },
      { voteHistory: [vote(true), vote(true)], missionResults: [mission(true, 0)] },
    );
    expect(r.cue).toEqual({ kind: 'missionSuccess', roundIndex: 0 });
  });

  it('fires missionFail when a failed mission is appended', () => {
    const r = decideCue(
      { votes: 3, missions: 1 },
      {
        voteHistory: [vote(true), vote(true), vote(true)],
        missionResults: [mission(true, 0), mission(false, 1)],
      },
    );
    expect(r.cue).toEqual({ kind: 'missionFail', roundIndex: 1 });
  });

  it('mission completion takes priority over a vote in the same tick', () => {
    const r = decideCue(
      { votes: 1, missions: 0 },
      { voteHistory: [vote(true), vote(true)], missionResults: [mission(false, 1)] },
    );
    expect(r.cue).toEqual({ kind: 'missionFail', roundIndex: 1 });
  });

  it('no change fires nothing', () => {
    const r = decideCue(
      { votes: 2, missions: 1 },
      { voteHistory: [vote(true), vote(true)], missionResults: [mission(true)] },
    );
    expect(r.cue).toBeNull();
    expect(r.next).toEqual({ votes: 2, missions: 1 });
  });
});
