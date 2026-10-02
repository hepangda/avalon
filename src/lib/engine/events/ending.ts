import {
  canStartAssassination,
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
  RevealedRole
} from '../types';
import { pushPublic } from './log';
import { clone, err, ok } from './result';

// ---------------------------------------------------------------------------
// START_ASSASSINATION → abandon unfinished decisions, enter Assassination
// ---------------------------------------------------------------------------

export function startAssassination(s: GameState, by: PlayerId, admin = false, actor?: string): EngineResult {
  if (!canStartAssassination(s)) {
    return err('WRONG_PHASE', 'Assassination cannot be started now');
  }
  if (!admin && s.assassinId !== by) return err('NOT_ASSASSIN', 'Only the assassin may act');

  const next = clone(s);
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
