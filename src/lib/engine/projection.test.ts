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
  it.each(['RoleReveal', 'TeamBuilding', 'Voting', 'MissionVote', 'MissionResult', 'LadyOfLake', 'Assassination', 'GameOver'] as const)(
    'preserves every role’s perception in %s, including after reconnecting at game over',
    (phase) => {
      const roles: Role[] = [
        'Merlin', 'Percival', 'LoyalServant', 'Morgana',
        'Assassin', 'Mordred', 'Minion', 'Oberon',
      ];
      const state = buildStartedGame(roles);
      state.phase = phase;
      const expected = [
        ['p3', 'p4', 'p6', 'p7'], // Merlin cannot see Mordred.
        ['p0', 'p3'], // Percival cannot distinguish Merlin and Morgana.
        [],
        ['p4', 'p5', 'p6'],
        ['p3', 'p5', 'p6'],
        ['p3', 'p4', 'p6'],
        ['p3', 'p4', 'p5'],
        [], // Oberon and Loyal Servant have no perception.
      ];
      for (const [i, player] of state.players.entries()) {
        const view = projectStateForViewer(state, player.id);
        expect(view.knownPlayers.map((known) => known.playerId)).toEqual(expected[i]);
        for (const known of view.knownPlayers) {
          if (known.shownAs === 'known-ally') {
            expect(known.role).toBe(state.players.find((p) => p.id === known.playerId)?.role);
            expect(known.role).not.toBe('Oberon');
          } else {
            expect(known).not.toHaveProperty('role');
          }
        }
      }
      expect(projectStateForViewer(state, 'spectator').knownPlayers).toEqual([]);
    },
  );

  it('the player list exposes only the viewer’s own role before Assassination', () => {
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
    s.votes = {
      p0: 'approve',
      p1: 'reject',
      p2: 'approve',
      p3: 'reject',
      p4: 'approve',
    };
    const view = projectStateForViewer(s, 'p2');
    const p0 = view.votes!.find((v) => v.playerId === 'p0')!;
    expect(p0.vote).toBe('approve');
  });

  it('mission cards are never present in projection; only failCount', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'MissionResult';
    s.missionResults = [
      {
        roundIndex: 0,
        teamSize: 2,
        team: ['p3', 'p4'],
        success: false,
        failCount: 1,
        cards: {},
      },
    ];
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
    expect(holderView.privateLadyResult).toEqual({
      targetId: 'p0',
      loyalty: 'good',
    });
    const otherView = projectStateForViewer(s, 'p1');
    expect(otherView.privateLadyResult).toBeUndefined();
  });

  it('assassin candidates only surface for the assassin during Assassination', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'Assassination';
    const assassin = s.assassinId!;
    const view = projectStateForViewer(s, assassin);
    expect(view.assassinCandidates).toEqual(['p0', 'p1', 'p2']);
    const other = projectStateForViewer(s, 'p0');
    expect(other.assassinCandidates).toBeUndefined();
  });

  it('reveals every evil role, including Oberon, at Assassination without exposing good identities', () => {
    const roles: Role[] = [
      'Merlin',
      'Percival',
      'LoyalServant',
      'LoyalServant',
      'LoyalServant',
      'LoyalServant',
      'Morgana',
      'Mordred',
      'Oberon',
      'Assassin',
    ];
    const state = buildStartedGame(roles);
    const viewers = [...state.players.map((player) => player.id), 'spectator'];
    const evilRoles = [
      ['p6', 'Morgana'],
      ['p7', 'Mordred'],
      ['p8', 'Oberon'],
      ['p9', 'Assassin'],
    ];

    for (const viewer of viewers) {
      const before = projectStateForViewer(state, viewer);
      expect(
        before.players.filter((player) => player.id !== viewer && player.role),
      ).toEqual([]);
    }

    state.phase = 'Assassination';
    for (const viewer of viewers) {
      const view = projectStateForViewer(state, viewer);
      const visibleOthers = view.players
        .filter((player) => player.id !== viewer && player.role)
        .map((player) => [player.id, player.role]);
      expect(visibleOthers).toEqual(evilRoles.filter(([id]) => id !== viewer));
    }
  });

  it('offers early assassination only to the active assassin, never other players or spectators', () => {
    const state = buildStartedGame(FIVE_P);
    for (const viewer of [
      ...state.players.map((player) => player.id),
      'spectator',
    ]) {
      expect(projectStateForViewer(state, viewer).canStartAssassination).toBe(
        viewer === state.assassinId,
      );
    }
    for (const phase of ['Lobby', 'Assassination', 'GameOver'] as const) {
      state.phase = phase;
      expect(
        projectStateForViewer(state, state.assassinId!).canStartAssassination,
      ).toBe(false);
    }
  });

  it('full reveal only at GameOver', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'GameOver';
    s.outcome = {
      winner: 'good',
      reason: 'three_missions',
      missionTally: { good: 3, evil: 0 },
      revealedRoles: s.players.map((p) => ({
        playerId: p.id,
        role: p.role,
        team: 'good' as const,
      })),
    };
    const view = projectStateForViewer(s, 'p2');
    expect(view.outcome).not.toBeNull();
    // Everyone's roles now visible.
    expect(view.players.every((p) => p.role !== undefined)).toBe(true);
  });
});

describe('public mission submission markers', () => {
  it('exposes submitted seats but never their choices, for players and spectators', () => {
    const s = buildStartedGame(FIVE_P);
    s.phase = 'MissionVote';
    s.proposedTeam = ['p0', 'p3', 'p4'];
    s.missionCards = { p3: 'fail', p4: 'success' };
    for (const id of ['p0', 'p3', 'spectator']) {
      const view = projectStateForViewer(s, id);
      expect(view.missionSubmissions).toEqual(['p3', 'p4']);
      expect(view).not.toHaveProperty('missionCards');
      expect(JSON.stringify(view.missionSubmissions)).not.toMatch(
        /success|fail/,
      );
    }
    s.phase = 'TeamBuilding';
    expect(projectStateForViewer(s, 'p3').missionSubmissions).toEqual([]);
  });
});
