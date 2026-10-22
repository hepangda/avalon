import { describe, expect, it } from 'vitest';
import { projectStateForViewer, type GameState } from '@/lib/engine';
import { applyEvent, buildScenario, type ScenarioId } from '@/lib/debug/scenarios';
import { isMyTurn, myTurn, turnAlertKey } from './turnAlert';

function view(state: GameState, viewerId: string) {
  return projectStateForViewer(state, viewerId);
}

function scene(id: ScenarioId) {
  const { state, viewerId } = buildScenario(id, 7);
  return { state, viewerId, game: view(state, viewerId) };
}

function bystander(state: GameState, ...busy: string[]) {
  return state.players.find((p) => !busy.includes(p.id))!.id;
}

describe('myTurn', () => {
  it('asks every unacknowledged player to confirm their identity', () => {
    const { state, viewerId } = scene('role');
    expect(myTurn(view(state, viewerId), viewerId)).toBe('role');
    expect(myTurn(view(state, bystander(state, viewerId)), bystander(state, viewerId))).toBe('role');
  });

  it('waits on the leader alone while the team is built, announced and finalized', () => {
    for (const [id, kind] of [['team', 'team'], ['announcement', 'startDiscussion'], ['finalizing', 'finalize']] as const) {
      const { state, viewerId, game } = scene(id);
      expect(myTurn(game, viewerId)).toBe(kind);
      const other = bystander(state, viewerId);
      expect(myTurn(view(state, other), other)).toBeNull();
    }
  });

  it('follows the speaker through discussion', () => {
    const { state, viewerId, game } = scene('discussion');
    expect(myTurn(game, viewerId)).toBe('speech');
    const next = applyEvent(state, { type: 'END_SPEECH', by: viewerId });
    expect(isMyTurn(view(next, viewerId), viewerId)).toBe(false);
    const speaker = next.discussion!.order[next.discussion!.speakerIndex]!;
    expect(myTurn(view(next, speaker), speaker)).toBe('speech');
  });

  it('asks for a vote until this player has cast one', () => {
    expect(myTurn(scene('voting').game, scene('voting').viewerId)).toBe('vote');
    const voted = scene('voted');
    expect(isMyTurn(voted.game, voted.viewerId)).toBe(false);
  });

  it('asks only team members who have not yet played a mission card', () => {
    const { state, viewerId, game } = scene('missionGood');
    expect(myTurn(game, viewerId)).toBe('mission');
    const outsider = bystander(state, ...state.proposedTeam!);
    expect(isMyTurn(view(state, outsider), outsider)).toBe(false);
    const submitted = scene('submitted');
    expect(isMyTurn(submitted.game, submitted.viewerId)).toBe(false);
  });

  it('wakes the Lady of the Lake holder', () => {
    const { state, viewerId, game } = scene('lady');
    expect(myTurn(game, viewerId)).toBe('lady');
    const other = bystander(state, viewerId);
    expect(isMyTurn(view(state, other), other)).toBe(false);
  });

  it('wakes the assassin, and only the assassin, for the strike', () => {
    const { state, viewerId, game } = scene('assassination');
    expect(myTurn(game, viewerId)).toBe('assassinate');
    const other = bystander(state, viewerId);
    expect(isMyTurn(view(state, other), other)).toBe(false);
  });

  it('asks allies to answer an early assassination ballot', () => {
    const { state, viewerId } = scene('earlyAssassinationProposal');
    const started = applyEvent(state, { type: 'REQUEST_ASSASSINATION', by: viewerId });
    const ally = started.earlyAssassination!.voterIds.find((id) => !started.earlyAssassination!.votes[id])!;
    expect(myTurn(view(started, ally), ally)).toBe('assassinationBallot');
  });

  it('never alerts spectators, an empty seat or a finished game', () => {
    const spectator = scene('spectator');
    expect(isMyTurn(spectator.game, spectator.viewerId)).toBe(false);
    expect(isMyTurn(scene('team').game, null)).toBe(false);
    const over = scene('goodWins');
    expect(isMyTurn(over.game, over.viewerId)).toBe(false);
  });
});

describe('turnAlertKey', () => {
  it('stays the same while others act inside the same turn', () => {
    const { state, viewerId, game } = scene('voting');
    const other = state.players.find((p) => p.id !== viewerId && state.votes[p.id] === undefined)!;
    const later = applyEvent(state, { type: 'CAST_VOTE', by: other.id, value: 'reject' });
    expect(turnAlertKey(view(later, viewerId), viewerId)).toBe(turnAlertKey(game, viewerId));
  });

  it('changes for each new speech and each new proposal', () => {
    const { state } = scene('discussion');
    const keys = new Set<string | null>();
    let next = state;
    for (const by of state.discussion!.order) {
      keys.add(turnAlertKey(view(next, by), by));
      next = applyEvent(next, { type: 'END_SPEECH', by });
    }
    expect(keys.size).toBe(state.discussion!.order.length);
    expect(keys.has(null)).toBe(false);
  });

  it('is null when nothing is waiting on this player', () => {
    const voted = scene('voted');
    expect(turnAlertKey(voted.game, voted.viewerId)).toBeNull();
  });
});
