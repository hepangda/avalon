import { describe, expect, it } from 'vitest';
import { createGame, reduce } from './reducer';
import { createRng } from './rng';
import { projectStateForViewer } from './projection';
import { buildStartedGame, DEFAULT_OPTIONS, FIVE_P, teamForCurrentMission } from './testkit';
import { canRerollOpening } from './fsm';
import { computeKnownPlayers } from './visibility';
import type { GameEvent, GameState } from './types';

function step(s: GameState, event: GameEvent): GameState {
  const result = reduce(s, event, { now: 123, rng: createRng('referee') });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
const back: GameEvent = { type: 'PREVIOUS_PHASE', actor: 'Referee' };
function approve(s: GameState) {
  for (const p of s.players) s = step(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
  return s;
}
function mission(s: GameState) {
  const team = teamForCurrentMission(s);
  s = step(s, { type: 'PROPOSE_TEAM', by: s.players[s.leaderIndex]!.id, team });
  s = approve(s);
  for (const by of team) s = step(s, { type: 'CAST_MISSION_CARD', by, card: 'success' });
  return s;
}

describe('referee phase control', () => {
  it('rewinds resolved votes, then proposals, without changing identities or connectivity', () => {
    let s = buildStartedGame(FIVE_P);
    s = step(s, { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] });
    s = approve(s);
    s = step(s, { type: 'SET_CONNECTED', by: 'p1', connected: false });
    s = step(s, { type: 'ACK_ROLE', by: 'p0' });
    const roles = s.players.map((p) => p.role);
    s = step(s, back);
    expect(s.phase).toBe('Voting');
    expect(s.proposedTeam).toEqual(['p0', 'p1']);
    expect(s.votes).toEqual({});
    expect(s.voteHistory).toEqual([]);
    expect(s.players[1]!.connected).toBe(false);
    expect(s.roleAcks).toEqual(['p0']);
    expect(s.players.map((p) => p.role)).toEqual(roles);
    s = step(s, back);
    expect(s.phase).toBe('TeamBuilding');
    expect(s.leaderIndex).toBe(0);
    expect(s.proposedTeam).toBeNull();
    expect(reduce(s, back, { now: 1, rng: createRng('s') }).ok).toBe(false);
  });

  it('restores the preceding mission and lets the entire team submit cards again', () => {
    let s = mission(buildStartedGame(FIVE_P));
    expect(s.roundIndex).toBe(1);
    s = step(s, back);
    expect(s.phase).toBe('MissionVote');
    expect(s.roundIndex).toBe(0);
    expect(s.missionResults).toEqual([]);
    expect(s.missionCards).toEqual({});
    for (const by of s.proposedTeam!)
      s = step(s, { type: 'CAST_MISSION_CARD', by, card: 'success' });
    expect(s.missionResults).toHaveLength(1);
  });

  it('restores Lady ownership and clears the abandoned private inspection', () => {
    let s = mission(mission(buildStartedGame(FIVE_P, { ladyOfTheLake: true })));
    expect(s.phase).toBe('LadyOfLake');
    const holder = s.ladyHolderId!;
    s = step(s, { type: 'USE_LADY', by: holder, target: 'p0' });
    s = step(s, back);
    expect(s.phase).toBe('LadyOfLake');
    expect(s.ladyHolderId).toBe(holder);
    expect(s.ladyInspectedIds).toEqual([]);
    expect(s.lastLadyResult).toBeNull();
    expect(projectStateForViewer(s, holder).privateLadyResult).toBeUndefined();
  });

  it('allows referee assassination and rollback, and keeps checkpoints private', () => {
    let s = buildStartedGame(FIVE_P);
    s = step(s, {
      type: 'START_ASSASSINATION',
      by: 'p0',
      admin: true,
      actor: 'Referee',
    });
    expect(s.phase).toBe('Assassination');
    expect(s.logs.at(-1)?.key).toBe('admin.assassinationStarted');
    s = step(s, { type: 'ASSASSINATE', by: 'p4', target: 'p0' });
    s = step(s, back);
    expect(s.phase).toBe('Assassination');
    expect(s.outcome).toBeNull();
    s = step(s, back);
    expect(s.phase).toBe('TeamBuilding');
    expect(projectStateForViewer(s, 'spectator')).not.toHaveProperty('phaseHistory');
    expect(projectStateForViewer(s, 'spectator').players.every((p) => !p.role)).toBe(true);
    expect(s.phaseRevision).toBe(2);
  });

  it('replays rollback deterministically from the same events', () => {
    const start = buildStartedGame(FIVE_P);
    const events: GameEvent[] = [
      { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] },
      ...start.players.map((p): GameEvent => ({
        type: 'CAST_VOTE',
        by: p.id,
        value: 'reject',
      })),
      back,
      ...start.players.map((p): GameEvent => ({
        type: 'CAST_VOTE',
        by: p.id,
        value: 'approve',
      })),
    ];
    expect(events.reduce(step, start)).toEqual(events.reduce(step, structuredClone(start)));
  });
});

describe('opening-only referee randomization', () => {
  const rerollLeader: GameEvent = { type: 'REROLL_LEADER', actor: 'Referee' };
  const rerollRoles: GameEvent = { type: 'REROLL_ROLES', actor: 'Referee' };

  it('randomizes the leader using injected randomness and moves the initial Lady holder', () => {
    const before = buildStartedGame(FIVE_P, { ladyOfTheLake: true });
    before.roleAcks = ['p0'];
    const res = reduce(before, rerollLeader, {
      now: 123,
      rng: { next: () => 0.7, shuffle: (xs) => [...xs] },
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.state.leaderIndex).toBe(3);
    expect(res.state.ladyHolderId).toBe('p2');
    expect(res.state.players).toEqual(before.players);
    expect(res.state.roleAcks).toEqual(['p0']);
    expect(res.state.phaseRevision).toBe(1);
    expect(res.state.logs.at(-1)).toMatchObject({
      key: 'admin.leaderRerolled', params: { actor: 'Referee', seat: 4 }, style: 'admin', at: 123,
    });
    expect(before.leaderIndex).toBe(0);
    expect(canRerollOpening(res.state)).toBe(true);
  });

  it('redeals configured roles, refreshes private knowledge and invalidates old acknowledgements', () => {
    const created = createGame({
      hostId: 'p0', players: FIVE_P.map((_, i) => ({ id: `p${i}`, name: `P${i}` })),
      options: { ...DEFAULT_OPTIONS, percival: true, morgana: true }, seed: 'opening',
    });
    if (!created.ok) throw new Error(created.error.message);
    let before = step(created.state, { type: 'START_GAME', by: 'p0' });
    before = step(before, { type: 'ACK_ROLE', by: 'p0' });
    before = step(before, { type: 'SET_CONNECTED', by: 'p1', connected: false });
    const next = step(before, rerollRoles);
    expect(next.players.map((p) => p.role).sort()).toEqual([...next.config.roles].sort());
    expect(next.players.map(({ role: _role, ...p }) => p))
      .toEqual(before.players.map(({ role: _role, ...p }) => p));
    expect(next.leaderIndex).toBe(before.leaderIndex);
    expect(next.ladyHolderId).toBe(before.ladyHolderId);
    expect(next.assassinId).toBe(next.players.find((p) => p.role === 'Assassin')!.id);
    expect(next.roleAcks).toEqual([]);
    expect(next.roleRevision).toBe(1);
    expect(next.logs.filter((l) => l.channel === 'private').every((l) => l.seq > before.logSeq)).toBe(true);
    expect(next.logs.some((l) => l.key === 'admin.rolesRerolled' && l.style === 'admin')).toBe(true);
    for (const player of next.players) {
      const view = projectStateForViewer(next, player.id);
      expect(view.selfRole).toBe(player.role);
      expect(view.knownPlayers).toEqual(computeKnownPlayers(player, next.players));
      expect(view.logs.filter((l) => l.key === 'yourRole')).toHaveLength(1);
      expect(view.logs.find((l) => l.key === 'yourRole')?.params?.role).toBe(player.role);
      expect(view.players.filter((p) => p.role !== undefined).map((p) => p.id)).toEqual([player.id]);
    }
    const spectator = projectStateForViewer(next, 'spectator');
    expect(spectator.selfRole).toBeNull();
    expect(spectator.knownPlayers).toEqual([]);
    expect(spectator.logs.every((l) => l.channel === 'public')).toBe(true);
    expect(spectator.players.every((p) => p.role === undefined)).toBe(true);
    expect(reduce(next, { type: 'ACK_ROLE', by: 'p0' }, { now: 1, rng: createRng('ack') }).ok).toBe(false);
    expect(step(next, { type: 'ACK_ROLE', by: 'p0', roleRevision: 1 }).roleAcks).toEqual(['p0']);
    expect(step(next, rerollRoles).roleRevision).toBe(2);
    expect(before.roleAcks).toEqual(['p0']);
    expect(step(before, rerollRoles)).toEqual(next);
  });

  it('rejects both tools after play starts, including after retracting or rewinding', () => {
    const initial = buildStartedGame(FIVE_P);
    const voting = step(initial, { type: 'PROPOSE_TEAM', by: 'p0', team: ['p0', 'p1'] });
    const assassination = step(initial, { type: 'START_ASSASSINATION', by: initial.assassinId! });
    const states: GameState[] = [
      { ...initial, phase: 'Lobby' },
      voting,
      step(voting, { type: 'RETRACT_PROPOSAL' }),
      step(voting, back),
      mission(initial),
      assassination,
      step(assassination, back),
      step(assassination, { type: 'ASSASSINATE', by: initial.assassinId!, target: 'p0' }),
    ];
    for (const state of states) {
      expect(canRerollOpening(state)).toBe(false);
      expect(projectStateForViewer(state, 'p0').canRerollOpening).toBe(false);
      for (const event of [rerollLeader, rerollRoles]) {
        expect(reduce(state, event, { now: 1, rng: createRng('late') })).toMatchObject({
          ok: false, error: { code: 'WRONG_PHASE' },
        });
      }
    }
  });

  it('does not close opening tools for viewing roles, presence updates or invalid proposals', () => {
    let state = step(buildStartedGame(FIVE_P), { type: 'ACK_ROLE', by: 'p0' });
    state = step(state, { type: 'SET_CONNECTED', by: 'p1', connected: false });
    expect(reduce(state, { type: 'PROPOSE_TEAM', by: 'p1', team: ['p0', 'p1'] }, {
      now: 1, rng: createRng('invalid'),
    }).ok).toBe(false);
    expect(canRerollOpening(state)).toBe(true);
    expect(projectStateForViewer(state, 'p0').canRerollOpening).toBe(true);
  });
});
