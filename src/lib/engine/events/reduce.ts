import { syncActionTimers } from '../timing';
import type {
  EngineContext,
  EngineResult,
  GameEvent,
  GameState
} from '../types';
import { ackRole, rerollOpening, startGame, useRerollCard } from './deal';
import { assassinate, requestAssassination, startAssassination, voteAssassination } from './ending';
import { applyLadyOfLake, castMissionCard } from './mission';
import { castVote, endSpeech, proposeTeam, retractProposal, retractVotes, setTimersPaused, startDiscussion } from './proposal';
import { phaseCheckpoint, previousPhase, setConnected } from './referee';
import { clone, err } from './result';
import { rolesPending } from '../fsm';

// ---------------------------------------------------------------------------
// Public reducer
// ---------------------------------------------------------------------------

export function reduce(state: GameState, event: GameEvent, ctx: EngineContext): EngineResult {
  const result = dispatch(state, event, ctx);
  // Stamp the wall-clock time on any log entries created during this reduce
  // (push helpers leave `at: 0`). Keeps the engine pure — time is injected.
  if (result.ok) {
    // ACK_ROLE may be idempotent; avoid modifying the input state in that case.
    if (result.state === state) result.state = clone(state);
    // Ballots never survive a finished game, natural assassination, or referee rollback.
    if (event.type === 'PREVIOUS_PHASE' || event.type === 'REROLL_LEADER' ||
      result.state.roleRevision !== state.roleRevision ||
      result.state.phase === 'Assassination' || result.state.phase === 'GameOver')
      result.state.earlyAssassination = null;
    if (event.type !== 'PREVIOUS_PHASE' && state.phase !== 'Lobby' && result.state.phase !== state.phase) {
      result.state.phaseHistory = [...(state.phaseHistory ?? []), phaseCheckpoint(state)];
    }
    if (result.state.phase === 'TeamBuilding' || result.state.phase === 'Assassination' || result.state.phase === 'GameOver')
      result.state.discussion = null;
    syncActionTimers(state, result.state, event, ctx.now);
    for (const log of result.state.logs) {
      if (log.at === 0) log.at = ctx.now;
    }
  }
  return result;
}

/** Everything that moves the game on, which must wait for every identity to be confirmed.
 *  A referee may still override, so an abandoned seat cannot hold the table forever. */
const PLAY_EVENTS = new Set<GameEvent['type']>([
  'PROPOSE_TEAM', 'FINALIZE_TEAM', 'START_DISCUSSION', 'END_SPEECH', 'SKIP_SPEECH', 'CAST_VOTE',
  'CAST_MISSION_CARD', 'USE_LADY', 'START_ASSASSINATION', 'REQUEST_ASSASSINATION', 'VOTE_ASSASSINATION', 'ASSASSINATE',
]);

export function dispatch(state: GameState, event: GameEvent, ctx: EngineContext): EngineResult {
  const referee = ('admin' in event && !!event.admin) || event.type === 'SKIP_SPEECH';
  if (PLAY_EVENTS.has(event.type) && !referee && rolesPending(state))
    return err('ROLES_PENDING', 'Waiting for every player to confirm their identity');
  switch (event.type) {
    case 'START_GAME':
      return startGame(state, event.by, event.flowVersion, event.assignedRoles, event.awaitRoleAcks);
    case 'ACK_ROLE':
      return ackRole(state, event.by, event.roleRevision);
    case 'USE_REROLL_CARD':
      return useRerollCard(state, event.by, event.roleRevision, ctx, event.assignedRoles);
    case 'REROLL_LEADER':
    case 'REROLL_ROLES':
      return rerollOpening(state, event, ctx);
    case 'PROPOSE_TEAM':
      return proposeTeam(state, event.by, event.team, event.admin ?? false);
    case 'FINALIZE_TEAM':
      return proposeTeam(state, event.by, event.team, event.admin ?? false, true);
    case 'START_DISCUSSION':
      return startDiscussion(state, event.by, event.direction);
    case 'END_SPEECH':
      return endSpeech(state, event.by);
    case 'SKIP_SPEECH':
      return endSpeech(state, event.target, event.actor);
    case 'SET_TIMERS_PAUSED':
      return setTimersPaused(state, event.paused, event.actor);
    case 'CAST_VOTE':
      return castVote(state, event.by, event.value, event.admin ?? false);
    case 'RETRACT_VOTES':
      return retractVotes(state);
    case 'RETRACT_PROPOSAL':
      return retractProposal(state);
    case 'CAST_MISSION_CARD':
      return castMissionCard(state, event.by, event.card);
    case 'USE_LADY':
      return applyLadyOfLake(state, event.by, event.target);
    case 'START_ASSASSINATION':
      return startAssassination(state, event.by, event.admin, event.actor);
    case 'REQUEST_ASSASSINATION':
      return requestAssassination(state, event.by);
    case 'VOTE_ASSASSINATION':
      return voteAssassination(state, event.by, event.proposalId, event.value);
    case 'PREVIOUS_PHASE':
      return previousPhase(state, event.actor);
    case 'ASSASSINATE':
      return assassinate(state, event.by, event.target);
    case 'SET_CONNECTED':
      return setConnected(state, event.by, event.connected);
    default: {
      const _exhaustive: never = event;
      return err('WRONG_PHASE', `Unhandled event ${JSON.stringify(_exhaustive)}`);
    }
  }
}
