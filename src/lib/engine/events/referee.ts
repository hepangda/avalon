import {
  playerById
} from '../fsm';
import type {
  EngineResult,
  GameState,
  PhaseCheckpoint,
  PlayerId
} from '../types';
import { pushPublic } from './log';
import { clone, err, ok } from './result';

/** Capture gameplay only: identities, connections, role acknowledgements and
 * the audit log remain current when a referee rewinds. */
export function phaseCheckpoint(s: GameState): PhaseCheckpoint {
  return structuredClone({
    phase: s.phase,
    roundIndex: s.roundIndex,
    leaderIndex: s.leaderIndex,
    rejectionCount: s.rejectionCount,
    proposedTeam: s.proposedTeam,
    teamChanged: s.teamChanged,
    discussion: s.discussion ?? null,
    votes: s.votes,
    missionCards: s.missionCards,
    missionResults: s.missionResults,
    voteHistory: s.voteHistory,
    ladyHolderId: s.ladyHolderId,
    ladyInspectedIds: s.ladyInspectedIds,
    pendingLady: s.pendingLady,
    lastLadyResult: s.lastLadyResult,
    outcome: s.outcome,
  });
}

export function previousPhase(s: GameState, actor: string): EngineResult {
  const checkpoint = s.phaseHistory?.at(-1);
  if (!checkpoint) return err('WRONG_PHASE', 'No previous phase to return to');
  const next = clone(s);
  Object.assign(next, structuredClone(checkpoint));
  next.phaseHistory = next.phaseHistory!.slice(0, -1);
  next.phaseRevision = (s.phaseRevision ?? 0) + 1;
  if (next.phase === 'Voting') next.votes = {};
  // An interrupted mission is replayed by every team member.
  next.missionCards = {};
  pushPublic(next, 'admin.phaseReturned', { actor, phase: next.phase }, 'admin');
  return ok(next);
}

// ---------------------------------------------------------------------------
// Connection flag (never alters game logic)
// ---------------------------------------------------------------------------

export function setConnected(s: GameState, by: PlayerId, connected: boolean): EngineResult {
  const p = playerById(s, by);
  if (!p) return err('UNKNOWN_PLAYER', `Unknown player ${by}`);
  const next = clone(s);
  const slot = next.players.find((x) => x.id === by)!;
  slot.connected = connected;
  return ok(next);
}
