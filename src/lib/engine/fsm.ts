import type { GameState, PlayerId } from './types';
import { missionSize, requiredFails } from './config';

/**
 * Pure FSM helpers & guards. No mutation, no I/O.
 */

export function goodWins(s: GameState): number {
  return s.missionResults.filter((m) => m.success).length;
}

export function evilWins(s: GameState): number {
  return s.missionResults.filter((m) => !m.success).length;
}

export function assassinInPlay(s: GameState): boolean {
  return s.players.some((p) => p.role === 'Assassin');
}

/** Only before the first proposal or assassination; rollback never reopens it. */
export function canRerollOpening(s: GameState): boolean {
  return (
    (s.phase === 'TeamBuilding' || s.phase === 'RoleReveal') &&
    !s.openingClosed &&
    s.roundIndex === 0 &&
    s.rejectionCount === 0 &&
    s.proposedTeam === null &&
    s.voteHistory.length === 0 &&
    s.missionResults.length === 0 &&
    (s.phaseHistory?.length ?? 0) === 0 &&
    s.outcome === null
  );
}

/** Whether normal play can be ended early by the assigned assassin. */
export function canStartAssassination(s: GameState): boolean {
  if (s.assassinId === null || !assassinInPlay(s)) return false;
  switch (s.phase) {
    case 'RoleReveal':
    case 'TeamBuilding':
    case 'TeamAnnouncement':
    case 'Discussion':
    case 'TeamFinalizing':
    case 'Voting':
    case 'MissionVote':
    case 'MissionResult':
    case 'LadyOfLake':
      return true;
    default:
      return false;
  }
}

export function playerById(s: GameState, id: PlayerId) {
  return s.players.find((p) => p.id === id);
}

export function leaderId(s: GameState): PlayerId {
  const leader = s.players.find((p) => p.seat === s.leaderIndex);
  if (!leader) throw new Error(`No player at leader seat ${s.leaderIndex}`);
  return leader.id;
}

export function currentMissionSize(s: GameState): number {
  return missionSize(s.config.playerCount, s.roundIndex);
}

export function currentRequiredFails(s: GameState): number {
  return requiredFails(s.config.playerCount, s.roundIndex);
}

export function allVotesIn(s: GameState): boolean {
  return Object.keys(s.votes).length === s.players.length;
}

export function voteApproved(s: GameState): boolean {
  const values = Object.values(s.votes);
  const approvals = values.filter((v) => v === 'approve').length;
  const rejections = values.length - approvals;
  // Strict majority required; ties reject.
  return approvals > rejections;
}

export function allCardsIn(s: GameState): boolean {
  if (!s.proposedTeam) return false;
  return s.proposedTeam.every((id) => s.missionCards[id] !== undefined);
}

export function nextLeaderIndex(s: GameState): number {
  return (s.leaderIndex + 1) % s.players.length;
}

/**
 * Whether Lady of the Lake is owed after the just-recorded mission result.
 * Triggers only after missions 2, 3, 4 (roundIndex 1,2,3 zero-based), when
 * enabled and the game is not already decided.
 */
export function ladyDue(s: GameState): boolean {
  return s.ladyEnabled && s.roundIndex >= 1 && s.roundIndex <= 3;
}
