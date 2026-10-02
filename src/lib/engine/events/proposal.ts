import { rejectionLimit } from '../config';
import {
  allVotesIn,
  currentMissionSize,
  leaderId,
  nextLeaderIndex,
  playerById,
  voteApproved
} from '../fsm';
import type {
  Effect,
  EngineResult,
  GameState,
  PlayerId,
  VoteValue
} from '../types';
import { buildOutcome } from './ending';
import { pushPrivate, pushPublic } from './log';
import { clone, err, ok } from './result';

// ---------------------------------------------------------------------------
// PROPOSE_TEAM → public announcement; FINALIZE_TEAM → Voting
// ---------------------------------------------------------------------------

export function proposeTeam(s: GameState, by: PlayerId, team: PlayerId[], admin = false, final = false): EngineResult {
  const expected = final ? 'TeamFinalizing' : 'TeamBuilding';
  if (s.phase !== expected) return err('WRONG_PHASE', `Not in ${expected}`);
  if (!admin && by !== leaderId(s)) return err('NOT_LEADER', 'Only the leader may propose');

  const size = currentMissionSize(s);
  if (team.length !== size) {
    return err('WRONG_TEAM_SIZE', `Team must have ${size} members, got ${team.length}`);
  }
  const unique = new Set(team);
  if (unique.size !== team.length) return err('DUPLICATE_TEAM_MEMBER', 'Duplicate team member');
  for (const id of team) {
    if (!playerById(s, id)) return err('INVALID_TEAM_MEMBER', `Unknown member ${id}`);
  }

  const next = clone(s);
  next.teamChanged = final && !!s.proposedTeam?.some((id) => !team.includes(id));
  next.proposedTeam = [...team];
  next.openingClosed = true;
  next.votes = {};
  next.discussion = null;
  next.phase = final || s.flowVersion === 1 ? 'Voting' : 'TeamAnnouncement';
  if (s.flowVersion !== 1) pushPublic(next, final ? 'teamFinalized' : 'teamAnnounced', {
    leader: by, team: team.join(','),
    ...(final ? { changed: s.proposedTeam?.some((id) => !team.includes(id)) ? 1 : 0 } : {}),
  });
  // Publish the draft and start the first speaking turn in the same state update.
  if (!final && s.flowVersion !== 1 && s.flowVersion !== 2 && s.flowVersion !== 5)
    return startDiscussion(next, leaderId(next));
  return ok(next);
}

export function startDiscussion(s: GameState, by: PlayerId, direction: 'clockwise' | 'counterclockwise' = 'clockwise'): EngineResult {
  if (direction !== 'clockwise' && direction !== 'counterclockwise') return err('INVALID_DIRECTION', 'Invalid speaking direction');
  if (s.phase !== 'TeamAnnouncement') return err('WRONG_PHASE', 'Not in TeamAnnouncement');
  if (by !== leaderId(s)) return err('NOT_LEADER', 'Only the leader may start discussion');
  const next = clone(s);
  const seats = [...s.players].sort((a, b) => a.seat - b.seat);
  // Start with the next seat so the leader closes the discussion. Older logs
  // retain their original order when restored or replayed.
  const offset = s.flowVersion === 2 || s.flowVersion === 3 ? 0 : 1;
  // Seats increase left-to-right along the bottom row: decreasing seats
  // move clockwise, starting at the leader's left hand.
  const step = s.flowVersion === 5 && direction === 'clockwise' ? -1 : 1;
  const start = seats.findIndex((p) => p.id === by) + offset * step;
  next.discussion = { order: seats.map((_, i) => seats[((start + i * step) % seats.length + seats.length) % seats.length]!.id), speakerIndex: 0 };
  next.phase = 'Discussion';
  pushPublic(next, 'speechBegins', { player: next.discussion.order[0]! });
  return ok(next);
}

export function endSpeech(s: GameState, by: PlayerId, referee?: string): EngineResult {
  if (s.phase !== 'Discussion' || !s.discussion) return err('WRONG_PHASE', 'Not in Discussion');
  if (s.discussion.order[s.discussion.speakerIndex] !== by) return err('NOT_SPEAKER', 'Only the current speaker may finish');
  const next = clone(s);
  if (referee !== undefined) pushPublic(next, 'admin.speechSkipped', { actor: referee, player: by }, 'admin');
  next.discussion!.speakerIndex += 1;
  if (next.discussion!.speakerIndex >= next.discussion!.order.length) {
    next.phase = 'TeamFinalizing';
    pushPublic(next, 'discussionFinished', { leader: leaderId(next) });
  } else {
    pushPublic(next, 'speechBegins', { player: next.discussion!.order[next.discussion!.speakerIndex]! });
  }
  return ok(next);
}

export function setTimersPaused(s: GameState, paused: boolean, actor: string): EngineResult {
  if (s.phase === 'Lobby' || s.phase === 'GameOver' || !s.actionTimers?.length)
    return err('WRONG_PHASE', 'No current timer');
  // Explicit pause/resume is idempotent, so retries never flip the clock back.
  if (s.actionTimers.every((timer) => (timer.pausedAt !== undefined) === paused)) return ok(s);
  const next = clone(s);
  pushPublic(next, paused ? 'admin.timersPaused' : 'admin.timersResumed', { actor }, 'admin');
  return ok(next);
}

// ---------------------------------------------------------------------------
// CAST_VOTE → (all in) resolve approve/reject/hammer
// ---------------------------------------------------------------------------

export function castVote(s: GameState, by: PlayerId, value: VoteValue, admin = false): EngineResult {
  if (s.phase !== 'Voting') return err('WRONG_PHASE', 'Not in Voting');
  if (!playerById(s, by)) return err('UNKNOWN_PLAYER', `Unknown player ${by}`);
  // Admin (referee) override may recast an existing vote; a normal vote may not.
  if (!admin && s.votes[by] !== undefined) return err('ALREADY_VOTED', 'Already voted');

  const next = clone(s);
  next.votes[by] = value;
  pushPrivate(next, by, value === 'approve' ? 'youApproved' : 'youRejected', {
    round: String(next.roundIndex + 1),
    proposal: String(next.rejectionCount + 1),
  });

  if (!allVotesIn(next)) return ok(next);

  // All votes in — resolve.
  const effects: Effect[] = [{ kind: 'PERSIST_CHECKPOINT', checkpoint: 'vote' }];
  const approved = voteApproved(next);
  const approves = Object.values(next.votes).filter((v) => v === 'approve').length;
  const rejects = next.players.length - approves;

  // Record this completed proposal in the full vote history (approved or not).
  next.voteHistory.push({
    roundIndex: next.roundIndex,
    proposalIndex: next.rejectionCount,
    leaderId: leaderId(next),
    team: next.proposedTeam ? [...next.proposedTeam] : [],
    votes: { ...next.votes },
    approved,
  });
  pushPublic(next, approved ? 'voteApproved' : 'voteRejected', {
    round: String(next.roundIndex + 1),
    proposal: String(next.rejectionCount + 1),
    approves: String(approves),
    rejects: String(rejects),
  });

  if (approved) {
    next.rejectionCount = 0;
    next.missionCards = {};
    next.phase = 'MissionVote';
    return ok(next, effects);
  }

  // Rejected.
  const limit = rejectionLimit(next.config.options.maxRejections);
  if (next.rejectionCount + 1 >= limit) {
    // The configured consecutive rejection limit ends the game (hammer).
    next.phase = 'GameOver';
    pushPublic(next, limit === 5 ? 'hammerEvilWins' : 'rejectionLimitReached', { count: limit });
    next.outcome = buildOutcome(next, 'evil', limit === 5 ? 'five_rejections' : 'rejection_limit');
    return ok(next, [
      ...effects,
      { kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_over' },
    ]);
  }

  next.rejectionCount += 1;
  next.leaderIndex = nextLeaderIndex(next);
  next.proposedTeam = null;
  next.votes = {};
  next.phase = 'TeamBuilding';
  pushPublic(next, 'proposalBegins', {
    leader: leaderId(next),
    round: String(next.roundIndex + 1),
    proposal: String(next.rejectionCount + 1),
  });
  return ok(next, effects);
}

// ---------------------------------------------------------------------------
// RETRACT_VOTES (referee) → clear all votes, stay in Voting
// ---------------------------------------------------------------------------

export function retractVotes(s: GameState): EngineResult {
  if (s.phase !== 'Voting') return err('WRONG_PHASE', 'Not in Voting');
  const next = clone(s);
  next.votes = {};
  return ok(next);
}

// ---------------------------------------------------------------------------
// RETRACT_PROPOSAL (referee) → back to TeamBuilding, same leader re-proposes
// ---------------------------------------------------------------------------

export function retractProposal(s: GameState): EngineResult {
  if (!['Voting', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing'].includes(s.phase))
    return err('WRONG_PHASE', 'No active proposal');
  const next = clone(s);
  next.proposedTeam = null;
  next.votes = {};
  next.phase = 'TeamBuilding';
  return ok(next);
}
