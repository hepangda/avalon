import { describe, expect, it } from 'vitest';
import { buildReplayModel } from './replayModel';
import { replaySteps, viewpointNotes } from './replaySteps';
import type { ReplayData } from './replayTypes';

const roles = ['Merlin', 'Assassin', 'LoyalServant', 'Morgana', 'Percival'] as const;

function replay(overrides: Partial<ReplayData> = {}): ReplayData {
  return {
    gameId: 'g',
    outcome: { winner: 'good', reason: 'assassin_missed', missionTally: { good: 3, evil: 0 }, revealedRoles: [] },
    players: roles.map((_, i) => ({ id: `p${i}`, name: `P${i}`, seat: i })),
    roleAssignments: roles.map((role, i) => ({ playerId: `p${i}`, role })),
    rounds: [{
      roundIndex: 0,
      leaderPlayerId: 'p3',
      teamSize: 2,
      finalTeam: ['p0', 'p2'],
      approved: true,
      missionSuccess: true,
      failCount: 0,
      votes: [
        ...['p0', 'p1', 'p2', 'p3', 'p4'].map((playerId) => ({ proposalIndex: 0, playerId, value: 'reject' as const })),
        ...['p0', 'p1', 'p2', 'p3', 'p4'].map((playerId) => ({ proposalIndex: 1, playerId, value: 'approve' as const })),
      ],
      missionCards: [{ playerId: 'p0', card: 'success' }, { playerId: 'p2', card: 'success' }],
    }],
    ladyChecks: [{ roundIndex: 1, holderPlayerId: 'p4', targetPlayerId: 'p1', revealedTeam: 'evil' }],
    assassination: { assassinPlayerId: 'p1', targetPlayerId: 'p2', hitMerlin: false },
    ...overrides,
  };
}

describe('buildReplayModel', () => {
  it('keeps missing legacy roles and rounds unknown after migration', () => {
    const data = replay();
    const archived = { ...data } as Partial<ReplayData>;
    delete archived.roleAssignments;
    delete archived.rounds;
    delete archived.ladyChecks;
    const model = buildReplayModel(archived as ReplayData);
    expect(model.players.every((player) => player.role === undefined)).toBe(true);
    expect(model.missions.every((mission) => mission.proposals.length === 0 && mission.success === null)).toBe(true);
    expect(model.outcome).toEqual(data.outcome);
  });
  it('infers leaders and leaves unknown teams empty for archives without proposals', () => {
    const [first, second] = buildReplayModel(replay()).missions[0]!.proposals;
    expect(first).toMatchObject({ leaderId: 'p3', team: null, approved: false, rejects: 5 });
    expect(second).toMatchObject({ leaderId: 'p4', team: ['p0', 'p2'], approved: true, approves: 5 });
  });

  it('places Lady of the Lake after the mission that preceded it', () => {
    const model = buildReplayModel(replay());
    expect(model.missions[0]!.lady?.targetPlayerId).toBe('p1');
    expect(model.missions[1]!.lady).toBeNull();
  });

  it('reads the announced draft, speaking order and referee notes from the log', () => {
    const at = 1_000;
    const model = buildReplayModel(replay({
      rounds: [{
        ...replay().rounds[0]!,
        proposals: [
          { proposalIndex: 0, leaderPlayerId: 'p3', team: ['p3', 'p4'], approved: false },
          { proposalIndex: 1, leaderPlayerId: 'p4', team: ['p0', 'p2'], approved: true },
        ],
      }],
      log: [
        { seq: 1, roundIndex: 0, at, channel: 'public', key: 'proposalBegins', params: { round: '1', proposal: '1', leader: 'p3' } },
        { seq: 2, roundIndex: 0, at, channel: 'public', key: 'teamAnnounced', params: { leader: 'p3', team: 'p3,p4' } },
        { seq: 3, roundIndex: 0, at, channel: 'public', key: 'speechBegins', params: { player: 'p4' } },
        { seq: 4, roundIndex: 0, at, channel: 'public', key: 'speechBegins', params: { player: 'p0' } },
        { seq: 5, roundIndex: 0, at: at + 60_000, channel: 'public', key: 'proposalBegins', params: { round: '1', proposal: '2', leader: 'p4' } },
        { seq: 6, roundIndex: 0, at, channel: 'public', key: 'teamAnnounced', params: { leader: 'p4', team: 'p0,p1' } },
        { seq: 7, roundIndex: 0, at, channel: 'public', key: 'admin.votesRetracted', params: { actor: 'Ref' }, style: 'admin' },
      ],
      startedAt: at,
      endedAt: at + 30 * 60_000,
    }));
    const [first, second] = model.missions[0]!.proposals;
    expect(first).toMatchObject({ team: ['p3', 'p4'], draftTeam: null, speakers: ['p4', 'p0'] });
    expect(second).toMatchObject({ draftTeam: ['p0', 'p1'], startedAt: at + 60_000 });
    expect(second!.referee).toHaveLength(1);
    expect(model.proposalCount).toBe(2);
  });

  it('does not treat a round lost to rejections as approved', () => {
    const model = buildReplayModel(replay({
      rounds: [{ ...replay().rounds[0]!, approved: null, missionSuccess: null, failCount: null, finalTeam: null, missionCards: [],
        votes: replay().rounds[0]!.votes.filter((v) => v.proposalIndex === 0) }],
    }));
    expect(model.missions[0]).toMatchObject({ success: null, team: null });
    expect(model.missions[0]!.proposals[0]!.approved).toBe(false);
  });
});

describe('replaySteps', () => {
  it('plays deal, every nomination, the quest, the lady, the strike and the end in order', () => {
    const model = buildReplayModel(replay());
    const steps = replaySteps(model);
    expect(steps.map((s) => s.key)).toEqual(['deal', 'v0:0', 'v0:1', 'q0', 'l0', 'strike', 'end']);
    expect(steps.map((s) => s.settled)).toEqual([0, 0, 0, 1, 1, 1, 1]);
    expect(steps.map((s) => s.leaderId)).toEqual(['p3', 'p3', 'p4', 'p4', 'p4', 'p4', 'p4']);
    // The lady waits with her first holder, then stays with whoever she examined.
    expect(steps.map((s) => s.ladyId)).toEqual(['p4', 'p4', 'p4', 'p4', 'p4', 'p1', 'p1']);
  });

  it('tags every seat from above and only known seats from a viewpoint', () => {
    const model = buildReplayModel(replay());
    expect(viewpointNotes(model, null)).toEqual({ p0: 'Merlin', p1: 'Assassin', p2: 'LoyalServant', p3: 'Morgana', p4: 'Percival' });
    expect(viewpointNotes(model, 'p2')).toEqual({ p2: 'LoyalServant' });
    expect(viewpointNotes(model, 'p4')).toEqual({ p4: 'Percival', p0: 'merlin-or-morgana', p3: 'merlin-or-morgana' });
  });
});
