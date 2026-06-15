import { describe, it, expect } from 'vitest';
import type { GameState, Role } from './types';
import { projectStateForViewer } from './projection';
import { buildStartedGame, FIVE_P } from './testkit';

function setupVoting(): GameState {
  const s = buildStartedGame(FIVE_P);
  s.phase = 'Voting';
  s.proposedTeam = ['p0', 'p1'];
  s.votes = { p0: 'approve', p1: 'reject' }; // partial
  return s;
}

describe('projectStateForViewer — security boundary', () => {
  it('a player sees only their own role pre-GameOver', () => {
    const s = buildStartedGame(FIVE_P);
    const view = projectStateForViewer(s, 'p0');
    const self = view.players.find((p) => p.id === 'p0')!;
    expect(self.role).toBe('Merlin');
    for (const p of view.players) {
      if (p.id !== 'p0') expect(p.role).toBeUndefined();
    }
    expect(view.selfRole).toBe('Merlin');
  });

  it('LoyalServant viewer gets empty knownPlayers', () => {
    const s = buildStartedGame(FIVE_P);
    const view = projectStateForViewer(s, 'p2'); // LoyalServant
    expect(view.knownPlayers).toEqual([]);
  });

  it('Merlin viewer gets curated evil knownPlayers, never raw roles', () => {
    const s = buildStartedGame(FIVE_P);
    const view = projectStateForViewer(s, 'p0'); // Merlin
    // FIVE_P: Morgana p3, Assassin p4 → both visible as evil.
    const seen = view.knownPlayers.map((k) => k.playerId).sort();
    expect(seen).toEqual(['p3', 'p4']);
    // Still no raw roles leak on other players.
    expect(view.players.find((p) => p.id === 'p3')!.role).toBeUndefined();
  });

  it('spectator gets no roles, no knownPlayers, no private fields', () => {
    const s = buildStartedGame(FIVE_P);
    const view = projectStateForViewer(s, 'spectator-x');
    expect(view.isSpectator).toBe(true);
    expect(view.selfRole).toBeNull();
    expect(view.knownPlayers).toEqual([]);
    expect(view.players.every((p) => p.role === undefined)).toBe(true);
    expect(view.assassinCandidates).toBeUndefined();
    expect(view.privateLadyResult).toBeUndefined();
  });

  it('individual votes hidden until all in', () => {
    const s = setupVoting();
    const view = projectStateForViewer(s, 'p2');
    expect(view.votes).not.toBeNull();
    for (const v of view.votes!) {
      expect(v.vote).toBeUndefined(); // not all in yet
    }
    const p0 = view.votes!.find((v) => v.playerId === 'p0')!;
    expect(p0.hasVoted).toBe(true);
    expect(view.votes!.find((v) => v.playerId === 'p4')!.hasVoted).toBe(false);
  });

  it('votes revealed once all are in', () => {
    const s = setupVoting();
    s.votes = { p0: 'approve', p1: 'reject', p2: 'approve', p3: 'reject', p4: 'approve' };
    const view = projectStateForViewer(s, 'p2');
    const p0 = view.votes!.find((v) => v.playerId === 'p0')!;
    expect(p0.vote).toBe('approve');
  });

  it('mission cards are never present in projection; only failCount', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'MissionResult';
    s.missionResults = [{ roundIndex: 0, teamSize: 2, team: ['p3', 'p4'], success: false, failCount: 1, cards: {} }];
    const view = projectStateForViewer(s, 'p3');
    // The client mission result exposes failCount but not who played what.
    const mr = view.missionResults[0]!;
    expect(mr.failCount).toBe(1);
    expect(mr.success).toBe(false);
    const mrRecord = mr as unknown as Record<string, unknown>;
    expect(mrRecord.team).toBeUndefined();
    expect(mrRecord.cards).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"cards"');
  });

  it('private Lady result only goes to the holder who inspected', () => {
    const s = buildStartedGame(FIVE_P, { ladyOfTheLake: true });
    s.lastLadyResult = { holderId: 'p4', targetId: 'p0', loyalty: 'good' };
    const holderView = projectStateForViewer(s, 'p4');
    expect(holderView.privateLadyResult).toEqual({ targetId: 'p0', loyalty: 'good' });
    const otherView = projectStateForViewer(s, 'p1');
    expect(otherView.privateLadyResult).toBeUndefined();
  });

  it('assassin candidates only surface for the assassin during Assassination', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'Assassination';
    const assassin = s.assassinId!;
    const view = projectStateForViewer(s, assassin);
    expect(view.assassinCandidates).toBeDefined();
    // Candidates are the 3 good players; ids only.
    expect(view.assassinCandidates!.length).toBe(3);
    const other = projectStateForViewer(s, 'p0');
    expect(other.assassinCandidates).toBeUndefined();
  });

  it('full reveal only at GameOver', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'GameOver';
    s.outcome = {
      winner: 'good',
      reason: 'three_missions',
      missionTally: { good: 3, evil: 0 },
      revealedRoles: s.players.map((p) => ({ playerId: p.id, role: p.role, team: 'good' as const })),
    };
    const view = projectStateForViewer(s, 'p2');
    expect(view.outcome).not.toBeNull();
    // Everyone's roles now visible.
    expect(view.players.every((p) => p.role !== undefined)).toBe(true);
  });

  it('roles never present before GameOver for non-self players (deep check)', () => {
    const roles: Role[] = FIVE_P;
    const s = buildStartedGame(roles);
    const view = projectStateForViewer(s, 'p1'); // Percival
    const leakedRoles = view.players.filter((p) => p.id !== 'p1' && p.role !== undefined);
    expect(leakedRoles).toHaveLength(0);
  });

  it('projects roleAcks so the client can gate the role-reveal overlay', () => {
    const s = buildStartedGame(FIVE_P);
    s.roleAcks = ['p1', 'p3'];
    const view = projectStateForViewer(s, 'p2');
    expect(view.roleAcks).toEqual(['p1', 'p3']);
    // It's a copy, not the engine's array.
    expect(view.roleAcks).not.toBe(s.roleAcks);
  });
});
