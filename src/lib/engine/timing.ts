import { speechDuration } from './config';
import { leaderId } from './fsm';
import type { ActionTimer, GameEvent, GameState, TimedAction } from './types';

function resumeTimer(timer: ActionTimer, now: number): ActionTimer {
  const { pausedAt, ...running } = timer;
  return pausedAt === undefined ? running : {
    ...running, startedAt: timer.startedAt + Math.max(0, now - pausedAt),
  };
}

/** Reconcile pending actions after an event. Time never dispatches a game event. */
export function syncActionTimers(previous: GameState, next: GameState, event: GameEvent, now: number): void {
  const pending: Array<{ playerId: string; action: TimedAction }> = [];
  const add = (playerId: string | null | undefined, action: TimedAction) => {
    // Identity viewing takes priority over that player's next game action.
    if (playerId && (action === 'role' || next.roleAcks.includes(playerId)))
      pending.push({ playerId, action });
  };
  if (next.phase !== 'Lobby' && next.phase !== 'GameOver') {
    for (const p of next.players) if (!next.roleAcks.includes(p.id)) add(p.id, 'role');
    switch (next.phase) {
      case 'TeamBuilding': add(leaderId(next), 'propose'); break;
      case 'TeamAnnouncement': add(leaderId(next), 'announce'); break;
      case 'Discussion': add(next.discussion?.order[next.discussion.speakerIndex], 'speak'); break;
      case 'TeamFinalizing': add(leaderId(next), 'finalize'); break;
      case 'Voting':
        for (const p of next.players) if (next.votes[p.id] === undefined) add(p.id, 'vote');
        break;
      case 'MissionVote':
        for (const id of next.proposedTeam ?? []) if (next.missionCards[id] === undefined) add(id, 'mission');
        break;
      case 'LadyOfLake': add(next.ladyHolderId, 'lady'); break;
      case 'Assassination': add(next.assassinId, 'assassinate'); break;
    }
  }
  const reset = previous.phase !== next.phase || previous.roundIndex !== next.roundIndex ||
    previous.rejectionCount !== next.rejectionCount || previous.phaseRevision !== next.phaseRevision ||
    previous.discussion?.speakerIndex !== next.discussion?.speakerIndex || event.type === 'RETRACT_VOTES';
  const carryPause = !reset && previous.actionTimers?.some((timer) => timer.pausedAt !== undefined);
  const speechMs = speechDuration(next.config.options.speechSeconds) * 1000;
  next.actionTimers = pending.map(({ playerId, action }): ActionTimer => {
    const keep = action === 'role'
      ? previous.roleRevision === next.roleRevision
      : !reset;
    const existing = keep && previous.actionTimers?.find((timer) => timer.playerId === playerId && timer.action === action);
    return existing ? (reset ? resumeTimer(existing, now) : { ...existing }) : {
      playerId, action, startedAt: now,
      // The evil team's assassination discussion gets 1.5 times the speaking time.
      durationMs: action === 'announce' && next.flowVersion === 5 ? speechMs / 2 : action === 'speak' ? speechMs : action === 'assassinate' ? speechMs * 1.5 : 20_000,
      ...(carryPause ? { pausedAt: now } : {}),
    };
  });
  if (event.type === 'SET_TIMERS_PAUSED') {
    next.actionTimers = next.actionTimers.map((timer) => event.paused
      ? { ...timer, pausedAt: timer.pausedAt ?? now }
      : resumeTimer(timer, now));
  }
}
