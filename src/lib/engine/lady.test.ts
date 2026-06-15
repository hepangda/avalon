import { describe, it, expect } from 'vitest';
import type { EngineContext, GameState, Role } from './types';
import { reduce } from './reducer';
import { createRng } from './rng';
import { buildStartedGame } from './testkit';

const CTX: EngineContext = { now: 0, rng: createRng('ctx') };

function apply(state: GameState, event: Parameters<typeof reduce>[1]): GameState {
  const r = reduce(state, event, CTX);
  if (!r.ok) throw new Error(`Unexpected refusal: ${r.error.code} ${r.error.message}`);
  return r.state;
}
function refusal(state: GameState, event: Parameters<typeof reduce>[1]) {
  const r = reduce(state, event, CTX);
  expect(r.ok).toBe(false);
  return r;
}
function leader(s: GameState): string {
  return s.players.find((p) => p.seat === s.leaderIndex)!.id;
}

const LADY_ROLES: Role[] = [
  'Merlin', 'Percival', 'LoyalServant', 'LoyalServant', 'Morgana', 'Assassin', 'Mordred',
];

/** Push the game to LadyOfLake by completing mission `roundIndex`. */
function reachLadyAfterMission(roundIndex: number): GameState {
  let s = buildStartedGame(LADY_ROLES, { ladyOfTheLake: true });
  // Pre-fill prior mission results so that NEITHER side reaches 3 wins before
  // or at this mission (otherwise the game ends instead of triggering Lady).
  // Strategy: make prior missions evil wins (capped at 2), pad remainder with
  // good wins, so after THIS mission's success both sides stay below 3.
  const prior = [];
  let evilSoFar = 0;
  for (let i = 0; i < roundIndex; i++) {
    const success = evilSoFar >= 2; // first up-to-2 are evil fails, rest good
    if (!success) evilSoFar++;
    prior.push({
      roundIndex: i,
      teamSize: 3,
      team: [],
      success,
      failCount: success ? 0 : 1,
      cards: {},
    });
  }
  s.missionResults = prior;
  s.roundIndex = roundIndex;
  // Run this mission as a success with an all-good team of the right size.
  const size = s.config.roles.length === 7 ? [2, 3, 3, 4, 4][roundIndex]! : 3;
  const team = ['p0', 'p1', 'p2', 'p3'].slice(0, size);
  s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team });
  for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
  for (const id of s.proposedTeam!) s = apply(s, { type: 'CAST_MISSION_CARD', by: id, card: 'success' });
  return s;
}

describe('Lady of the Lake', () => {
  it('triggers after mission 2 (roundIndex 1)', () => {
    const s = reachLadyAfterMission(1);
    expect(s.phase).toBe('LadyOfLake');
    expect(s.pendingLady).toBe(true);
  });

  it('triggers after missions 3 and 4', () => {
    expect(reachLadyAfterMission(2).phase).toBe('LadyOfLake');
    expect(reachLadyAfterMission(3).phase).toBe('LadyOfLake');
  });

  it('does NOT trigger after mission 1', () => {
    const s = reachLadyAfterMission(0);
    expect(s.phase).toBe('TeamBuilding');
  });

  it('reveals only loyalty; Mordred reads as evil', () => {
    const s = reachLadyAfterMission(1);
    const mordred = s.players.find((p) => p.role === 'Mordred')!.id;
    // Ensure the holder is someone other than Mordred so the inspection is valid.
    const holder = s.players.find((p) => p.role !== 'Mordred')!.id;
    s.ladyHolderId = holder;
    const r = reduce(s, { type: 'USE_LADY', by: holder, target: mordred }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const priv = r.effects.find((e) => e.kind === 'PRIVATE_LADY');
      expect(priv).toBeDefined();
      if (priv && priv.kind === 'PRIVATE_LADY') {
        expect(priv.loyalty).toBe('evil');
      }
      expect(r.state.lastLadyResult?.loyalty).toBe('evil');
    }
  });

  it('passes token to inspected player and records inspector', () => {
    const s = reachLadyAfterMission(1);
    const holder = s.ladyHolderId!;
    const target = s.players.find((p) => p.id !== holder)!.id;
    const next = apply(s, { type: 'USE_LADY', by: holder, target });
    expect(next.ladyHolderId).toBe(target);
    expect(next.ladyInspectedIds).toContain(holder);
    expect(next.phase).toBe('TeamBuilding');
  });

  it('refuses inspecting a previously-inspected player', () => {
    const s = reachLadyAfterMission(1);
    const holder = s.ladyHolderId!;
    // Manually mark a target as already inspected.
    const target = s.players.find((p) => p.id !== holder)!.id;
    s.ladyInspectedIds = [target];
    const r = refusal(s, { type: 'USE_LADY', by: holder, target });
    if (!r.ok) expect(r.error.code).toBe('LADY_TARGET_INSPECTED');
  });

  it('refuses self-inspection', () => {
    const s = reachLadyAfterMission(1);
    const holder = s.ladyHolderId!;
    const r = refusal(s, { type: 'USE_LADY', by: holder, target: holder });
    if (!r.ok) expect(r.error.code).toBe('LADY_TARGET_SELF');
  });

  it('refuses a non-holder', () => {
    const s = reachLadyAfterMission(1);
    const notHolder = s.players.find((p) => p.id !== s.ladyHolderId)!.id;
    const target = s.players.find((p) => p.id !== notHolder && p.id !== s.ladyHolderId)!.id;
    const r = refusal(s, { type: 'USE_LADY', by: notHolder, target });
    if (!r.ok) expect(r.error.code).toBe('NOT_LADY_HOLDER');
  });

  it('disabled Lady never enters LadyOfLake', () => {
    let s = buildStartedGame(LADY_ROLES, { ladyOfTheLake: false });
    s.missionResults = [{ roundIndex: 0, teamSize: 2, team: [], success: true, failCount: 0, cards: {} }];
    s.roundIndex = 1;
    s = apply(s, { type: 'PROPOSE_TEAM', by: leader(s), team: ['p0', 'p1', 'p2'] });
    for (const p of s.players) s = apply(s, { type: 'CAST_VOTE', by: p.id, value: 'approve' });
    for (const id of s.proposedTeam!) s = apply(s, { type: 'CAST_MISSION_CARD', by: id, card: 'success' });
    expect(s.phase).toBe('TeamBuilding');
  });
});
