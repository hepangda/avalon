import {
  canStartAssassination,
  earlyAssassinationVoters,
  evilWins,
  goodWins,
  playerById
} from '../fsm';
import { teamOf } from '../roles';
import type {
  EngineResult,
  GameOutcome,
  GameState,
  PlayerId,
  RevealedRole,
  VoteValue,
} from '../types';
import { pushPrivate, pushPublic } from './log';
import { clone, err, ok } from './result';

export function requestAssassination(s: GameState, by: PlayerId): EngineResult {
  if (!canStartAssassination(s) || s.earlyAssassination) return err('WRONG_PHASE', 'Cannot request assassination now');
  const voterIds = earlyAssassinationVoters(s);
  if (!voterIds.includes(by)) return err('NOT_ASSASSIN', 'Only mutually known red teammates may request assassination');
  const next = clone(s);
  next.earlyAssassination = { id: s.logSeq + 1, initiatorId: by, voterIds, votes: { [by]: 'approve' } };
  for (const id of voterIds) pushPrivate(next, id, 'assassinationRequested', { player: by });
  return voterIds.length === 1 ? startAssassination(next, next.assassinId!) : ok(next);
}

export function voteAssassination(s: GameState, by: PlayerId, proposalId: number, value: VoteValue): EngineResult {
  const ballot = s.earlyAssassination;
  if (!canStartAssassination(s) || !ballot || ballot.id !== proposalId)
    return err('WRONG_PHASE', 'This assassination ballot is no longer active');
  if (!ballot.voterIds.includes(by)) return err('NOT_ASSASSIN', 'Only known red teammates may vote');
  if (value !== 'approve' && value !== 'reject') return err('WRONG_PHASE', 'Invalid vote');
  if (ballot.votes[by]) return err('ALREADY_VOTED', 'Already voted on this proposal');
  const next = clone(s);
  next.earlyAssassination!.votes[by] = value;
  if (value === 'reject') {
    for (const id of ballot.voterIds) pushPrivate(next, id, 'assassinationRejected', { player: by });
    next.earlyAssassination = null;
    return ok(next);
  }
  if (ballot.voterIds.every((id) => next.earlyAssassination!.votes[id] === 'approve'))
    return startAssassination(next, next.assassinId!);
  return ok(next);
}

// ---------------------------------------------------------------------------
// START_ASSASSINATION → abandon unfinished decisions, enter Assassination
// Retained for persisted legacy events and referee commands. Player requests
// enter through REQUEST_ASSASSINATION and unanimous VOTE_ASSASSINATION instead.
// ---------------------------------------------------------------------------

export function startAssassination(s: GameState, by: PlayerId, admin = false, actor?: string): EngineResult {
  if (!canStartAssassination(s)) {
    return err('WRONG_PHASE', 'Assassination cannot be started now');
  }
  if (!admin && s.assassinId !== by) return err('NOT_ASSASSIN', 'Only the assassin may act');

  const next = clone(s);
  next.earlyAssassination = null;
  next.phase = 'Assassination';
  next.openingClosed = true;
  next.proposedTeam = null;
  next.votes = {};
  next.missionCards = {};
  next.pendingLady = false;
  if (admin) pushPublic(next, 'admin.assassinationStarted', { actor: actor ?? by }, 'admin');
  else pushPublic(next, 'earlyAssassination', { player: by });
  return ok(next);
}

// ---------------------------------------------------------------------------
// ASSASSINATE → GameOver
// ---------------------------------------------------------------------------

export function assassinate(s: GameState, by: PlayerId, target: PlayerId): EngineResult {
  if (s.phase !== 'Assassination') return err('WRONG_PHASE', 'Not in Assassination');
  if (s.assassinId !== by) return err('NOT_ASSASSIN', 'Only the assassin may act');

  const targetPlayer = playerById(s, target);
  if (!targetPlayer) return err('ASSASSIN_TARGET_INVALID', `Unknown target ${target}`);
  if (target === by) return err('ASSASSIN_TARGET_INVALID', 'Cannot target self');
  if (teamOf(targetPlayer.role) !== 'good') {
    return err('ASSASSIN_TARGET_INVALID', 'Target must be on the blue team');
  }

  const next = clone(s);
  const hitMerlin = targetPlayer.role === 'Merlin';
  next.phase = 'GameOver';
  pushPublic(next, 'assassinStruck', { target });
  pushPublic(next, hitMerlin ? 'assassinHitMerlin' : 'assassinMissed');
  next.outcome = buildOutcome(
    next,
    hitMerlin ? 'evil' : 'good',
    hitMerlin ? 'assassinated_merlin' : 'assassin_missed',
    target,
  );
  return ok(next, [{ kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_over' }]);
}

// ---------------------------------------------------------------------------
// Outcome construction (full reveal only at GameOver)
// ---------------------------------------------------------------------------

export function buildOutcome(
  s: GameState,
  winner: GameOutcome['winner'],
  reason: GameOutcome['reason'],
  assassinTargetId?: PlayerId,
): GameOutcome {
  const revealedRoles: RevealedRole[] = s.players.map((p) => ({
    playerId: p.id,
    role: p.role,
    team: teamOf(p.role),
  }));
  return {
    winner,
    reason,
    missionTally: { good: goodWins(s), evil: evilWins(s) },
    ...(assassinTargetId ? { assassinTargetId } : {}),
    revealedRoles,
  };
}
