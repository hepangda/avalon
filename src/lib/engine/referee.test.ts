import { describe, expect, it } from 'vitest';
import { reduce } from './reducer';
import { createRng } from './rng';
import { projectStateForViewer } from './projection';
import { buildStartedGame, FIVE_P, teamForCurrentMission } from './testkit';
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
