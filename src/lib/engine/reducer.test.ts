import { describe, it, expect } from 'vitest';
import type { EngineContext, GameState, Role } from './types';
import { createGame, reduce } from './reducer';
import { createRng } from './rng';
import { teamOf } from './roles';
import { buildStartedGame, firstK, FIVE_P, evilIds, DEFAULT_OPTIONS } from './testkit';

const CTX: EngineContext = { now: 0, rng: createRng('ctx') };

function apply(state: GameState, event: Parameters<typeof reduce>[1]): GameState {
  const r = reduce(state, event, CTX);
  if (!r.ok) throw new Error(`Unexpected refusal: ${r.error.code} ${r.error.message}`);
  return r.state;
}

function expectRefusal(state: GameState, event: Parameters<typeof reduce>[1], code: string) {
  const r = reduce(state, event, CTX);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

function leader(s: GameState): string {
  return s.players.find((p) => p.seat === s.leaderIndex)!.id;
}

describe('Voting resolution', () => {
  it('strict-majority approval moves to MissionVote and resets rejections', () => {
    let s = buildStartedGame(FIVE_P);
    s.rejectionCount = 2;
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    // 3 approve, 2 reject → approved.
    s = apply(s, { type: 'CAST_VOTE', by: 'p0', value: 'approve' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p1', value: 'approve' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p2', value: 'approve' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p3', value: 'reject' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p4', value: 'reject' });
    expect(s.phase).toBe('MissionVote');
    expect(s.rejectionCount).toBe(0);
  });

  it('tie rejects (strict majority needed)', () => {
    // 6 players, 3-3 tie → reject.
    const roles: Role[] = ['Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'Morgana', 'Assassin'];
    let s = buildStartedGame(roles);
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    s = apply(s, { type: 'CAST_VOTE', by: 'p0', value: 'approve' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p1', value: 'approve' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p2', value: 'approve' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p3', value: 'reject' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p4', value: 'reject' });
    s = apply(s, { type: 'CAST_VOTE', by: 'p5', value: 'reject' });
    expect(s.phase).toBe('TeamBuilding');
    expect(s.rejectionCount).toBe(1);
  });

  it('leader rotates on rejection', () => {
    let s = buildStartedGame(FIVE_P);
    const firstLeaderSeat = s.leaderIndex;
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'reject' });
    expect(s.leaderIndex).toBe((firstLeaderSeat + 1) % 5);
  });

  it('five consecutive rejections → evil wins (hammer)', () => {
    let s = buildStartedGame(FIVE_P);
    for (let i = 0; i < 5; i++) {
      expect(s.phase).toBe('TeamBuilding');
      s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
      for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'reject' });
    }
    expect(s.phase).toBe('GameOver');
    expect(s.outcome?.winner).toBe('evil');
    expect(s.outcome?.reason).toBe('five_rejections');
  });

  it('an approval between rejects resets the counter', () => {
    let s = buildStartedGame(FIVE_P);
    // 2 rejects
    for (let i = 0; i < 2; i++) {
      s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
      for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'reject' });
    }
    expect(s.rejectionCount).toBe(2);
    // 1 approve
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    expect(s.rejectionCount).toBe(0);
    expect(s.phase).toBe('MissionVote');
  });

  it('records every completed proposal in voteHistory (approved & rejected)', () => {
    let s = buildStartedGame(FIVE_P);
    // First proposal: rejected.
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'reject' });
    // Second proposal: approved.
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });

    expect(s.voteHistory).toHaveLength(2);
    expect(s.voteHistory[0]!.approved).toBe(false);
    expect(s.voteHistory[0]!.proposalIndex).toBe(0);
    expect(s.voteHistory[1]!.approved).toBe(true);
    expect(s.voteHistory[1]!.proposalIndex).toBe(1);
    expect(Object.keys(s.voteHistory[0]!.votes)).toHaveLength(5);
    expect(s.voteHistory[1]!.roundIndex).toBe(0);
  });
});

describe('Mission resolution', () => {
  it('5p mission 1 fails with 1 fail card from an evil team member', () => {
    let s = buildStartedGame(FIVE_P); // mission 1 size = 2
    const evil = evilIds(s)[0]!; // Morgana p3
    const good = s.players.find((p) => teamOf(p.role) === 'good')!.id; // p0
    const team = [good, evil];
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: good, card: 'success' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: evil, card: 'fail' });
    const result = s.missionResults.at(-1)!;
    expect(result.failCount).toBe(1);
    expect(result.success).toBe(false); // 5p needs only 1 fail
  });

  it('7p mission 4 needs 2 fails: exactly 1 fail still succeeds', () => {
    const roles: Role[] = [
      'Merlin', 'Percival', 'LoyalServant', 'LoyalServant',
      'Morgana', 'Mordred', 'Assassin',
    ];
    let s = buildStartedGame(roles);
    s.roundIndex = 3; // mission 4
    // mission 4 size for 7p = 4. Put 1 evil on the team.
    const team = ['p0', 'p1', 'p4', 'p2']; // p4 = Morgana (evil)
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p0', card: 'success' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p1', card: 'success' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p4', card: 'fail' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p2', card: 'success' });
    const result = s.missionResults.at(-1)!;
    expect(result.failCount).toBe(1);
    expect(result.success).toBe(true); // needs 2 fails
  });

  it('7p mission 4 with 2 fails fails', () => {
    const roles: Role[] = [
      'Merlin', 'Percival', 'LoyalServant', 'LoyalServant',
      'Morgana', 'Mordred', 'Assassin',
    ];
    let s = buildStartedGame(roles);
    s.roundIndex = 3;
    const team = ['p0', 'p4', 'p5', 'p2']; // p4 Morgana, p5 Mordred
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p0', card: 'success' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p4', card: 'fail' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p5', card: 'fail' });
    s = apply(s, { type: 'CAST_MISSION_CARD', by: 'p2', card: 'success' });
    const result = s.missionResults.at(-1)!;
    expect(result.failCount).toBe(2);
    expect(result.success).toBe(false);
  });

  it('good reaching 3 mission wins with assassin → Assassination', () => {
    let s = buildStartedGame(FIVE_P);
    // Force 3 successful missions by manipulating missionResults then routing.
    s.missionResults = [
      { roundIndex: 0, teamSize: 2, team: [], success: true, failCount: 0, cards: {} },
      { roundIndex: 1, teamSize: 3, team: [], success: true, failCount: 0, cards: {} },
    ];
    s.roundIndex = 2;
    // Run mission 3 as success (all-good team).
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    const team = s.proposedTeam!;
    for (const id of team) s = apply(s, { type: 'CAST_MISSION_CARD', by: id, card: 'success' });
    expect(s.phase).toBe('Assassination');
  });

  it('evil reaching 3 fails → immediate evil win, no Lady detour', () => {
    let s = buildStartedGame(FIVE_P, { ladyOfTheLake: true });
    s.missionResults = [
      { roundIndex: 0, teamSize: 2, team: [], success: false, failCount: 1, cards: {} },
      { roundIndex: 1, teamSize: 3, team: [], success: false, failCount: 1, cards: {} },
    ];
    s.roundIndex = 2; // mission 3; Lady would trigger after if game continued
    const evil = evilIds(s)[0]!;
    const realTeam = [evil, s.players.find((p) => p.id !== evil)!.id];
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: realTeam });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    for (const id of s.proposedTeam!) {
      const pl = s.players.find((p) => p.id === id)!;
      s = apply(s, { type: 'CAST_MISSION_CARD', by: id, card: teamOf(pl.role) === 'evil' ? 'fail' : 'success' });
    }
    expect(s.phase).toBe('GameOver');
    expect(s.outcome?.winner).toBe('evil');
    expect(s.outcome?.reason).toBe('three_missions');
  });
});

describe('Assassination', () => {
  function reachAssassination(): GameState {
    const s = buildStartedGame(FIVE_P);
    s.missionResults = [
      { roundIndex: 0, teamSize: 2, team: [], success: true, failCount: 0, cards: {} },
      { roundIndex: 1, teamSize: 3, team: [], success: true, failCount: 0, cards: {} },
      { roundIndex: 2, teamSize: 2, team: [], success: true, failCount: 0, cards: {} },
    ];
    s.phase = 'Assassination';
    return s;
  }

  it('hitting Merlin → evil wins', () => {
    const s = reachAssassination();
    const merlin = s.players.find((p) => p.role === 'Merlin')!.id;
    const assassin = s.assassinId!;
    const out = apply(s, { type: 'ASSASSINATE', by: assassin, target: merlin });
    expect(out.phase).toBe('GameOver');
    expect(out.outcome?.winner).toBe('evil');
    expect(out.outcome?.reason).toBe('assassinated_merlin');
    expect(out.outcome?.assassinTargetId).toBe(merlin);
  });

  it('hitting non-Merlin good → good wins', () => {
    const s = reachAssassination();
    const target = s.players.find((p) => p.role === 'LoyalServant')!.id;
    const assassin = s.assassinId!;
    const out = apply(s, { type: 'ASSASSINATE', by: assassin, target });
    expect(out.outcome?.winner).toBe('good');
    expect(out.outcome?.reason).toBe('assassin_missed');
  });

  it('refuses targeting an evil player', () => {
    const s = reachAssassination();
    const evil = evilIds(s).find((id) => id !== s.assassinId)!;
    expectRefusal(s, { type: 'ASSASSINATE', by: s.assassinId!, target: evil }, 'ASSASSIN_TARGET_INVALID');
  });

  it('refuses a non-assassin actor', () => {
    const s = reachAssassination();
    const merlin = s.players.find((p) => p.role === 'Merlin')!.id;
    expectRefusal(s, { type: 'ASSASSINATE', by: merlin, target: merlin }, 'NOT_ASSASSIN');
  });
});

describe('Illegal moves are refused without mutation', () => {
  it('non-leader cannot propose', () => {
    const s = buildStartedGame(FIVE_P);
    const notLeader = s.players.find((p) => p.seat !== s.leaderIndex)!.id;
    expectRefusal(s, { type: 'PROPOSE_TEAM', by: notLeader, team: firstK(s, 2) }, 'NOT_LEADER');
  });

  it('wrong team size refused', () => {
    const s = buildStartedGame(FIVE_P);
    expectRefusal(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 3) }, 'WRONG_TEAM_SIZE');
  });

  it('duplicate team member refused', () => {
    const s = buildStartedGame(FIVE_P);
    expectRefusal(s, { type: 'PROPOSE_TEAM', by: leader(s), team: ['p0', 'p0'] }, 'DUPLICATE_TEAM_MEMBER');
  });

  it('voting twice refused', () => {
    let s = buildStartedGame(FIVE_P);
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    s = apply(s, { type: 'CAST_VOTE', by: 'p0', value: 'approve' });
    expectRefusal(s, { type: 'CAST_VOTE', by: 'p0', value: 'reject' }, 'ALREADY_VOTED');
  });

  it('mission card from non-team member refused', () => {
    let s = buildStartedGame(FIVE_P);
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    expectRefusal(s, { type: 'CAST_MISSION_CARD', by: 'p4', card: 'success' }, 'NOT_ON_TEAM');
  });

  it('good player playing fail refused', () => {
    let s = buildStartedGame(FIVE_P);
    // Build a team of two good players (Merlin p0, Percival p1).
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: ['p0', 'p1'] });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    expectRefusal(s, { type: 'CAST_MISSION_CARD', by: 'p0', card: 'fail' }, 'GOOD_CANNOT_FAIL');
  });

  it('event in wrong phase refused', () => {
    const s = buildStartedGame(FIVE_P); // TeamBuilding
    expectRefusal(s, { type: 'CAST_VOTE', by: 'p0', value: 'approve' }, 'WRONG_PHASE');
  });

  it('refused move does not mutate state', () => {
    const s = buildStartedGame(FIVE_P);
    const before = structuredClone(s);
    reduce(s, { type: 'CAST_VOTE', by: 'p0', value: 'approve' }, CTX);
    expect(s).toEqual(before);
  });
});

describe('Role reveal is per-player (no global RoleReveal gate)', () => {
  function freshGame(n = 5): GameState {
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const created = createGame({ hostId: 'p0', players, options: DEFAULT_OPTIONS, seed: 'reveal-seed' });
    if (!created.ok) throw new Error(created.error.code);
    return created.state;
  }

  it('START_GAME goes straight to TeamBuilding with no acks', () => {
    const s = apply(freshGame(), { type: 'START_GAME', by: 'p0' });
    expect(s.phase).toBe('TeamBuilding');
    expect(s.roleAcks).toEqual([]);
  });

  it('START_GAME logs the first round/proposal immediately', () => {
    const s = apply(freshGame(), { type: 'START_GAME', by: 'p0' });
    const keys = s.logs.map((l) => l.key);
    expect(keys).toContain('gameStarted');
    expect(keys).toContain('roundBegins');
    expect(keys).toContain('proposalBegins');
  });

  it('ACK_ROLE records the player without changing phase, and is idempotent', () => {
    let s = apply(freshGame(), { type: 'START_GAME', by: 'p0' });
    s = apply(s, { type: 'ACK_ROLE', by: 'p2' });
    expect(s.phase).toBe('TeamBuilding');
    expect(s.roleAcks).toEqual(['p2']);
    // Repeat ack — no duplicate, still fine.
    s = apply(s, { type: 'ACK_ROLE', by: 'p2' });
    expect(s.roleAcks).toEqual(['p2']);
  });

  it('all players acking does NOT reset acks or re-log the round', () => {
    let s = apply(freshGame(), { type: 'START_GAME', by: 'p0' });
    const roundLogsAfterStart = s.logs.filter((l) => l.key === 'roundBegins').length;
    for (const p of s.players) s = apply(s, { type: 'ACK_ROLE', by: p.id });
    expect(s.roleAcks.length).toBe(s.players.length);
    expect(s.phase).toBe('TeamBuilding');
    // No extra roundBegins logged by acking (it was logged at start).
    expect(s.logs.filter((l) => l.key === 'roundBegins').length).toBe(roundLogsAfterStart);
  });

  it('ACK_ROLE before the game starts is refused', () => {
    expectRefusal(freshGame(), { type: 'ACK_ROLE', by: 'p0' }, 'WRONG_PHASE');
  });

  it('a player can propose a team while others have not yet acked', () => {
    let s = apply(freshGame(), { type: 'START_GAME', by: 'p0' });
    // Only the leader acks, then immediately proposes — no waiting on others.
    s = apply(s, { type: 'ACK_ROLE', by: leader(s) });
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: firstK(s, 2) });
    expect(s.phase).toBe('Voting');
  });
});
