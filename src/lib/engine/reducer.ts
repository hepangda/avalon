import { validRoleAssignment } from './roleWeights';
import type {
  EngineContext,
  EngineError,
  EngineErrorCode,
  EngineResult,
  Effect,
  GameConfig,
  GameEvent,
  GameOptions,
  GameOutcome,
  GameState,
  MissionCard,
  PlayerId,
  PlayerSlot,
  PhaseCheckpoint,
  RevealedRole,
  Role,
  Team,
  VoteValue,
} from './types';
import { isValidPlayerCount, rejectionLimit } from './config';
import { buildRoleSet, isGood, teamOf, validateRoleSet } from './roles';
import { computeKnownPlayers } from './visibility';
import { createRng } from './rng';
import { syncActionTimers } from './timing';
import {
  allCardsIn,
  allVotesIn,
  assassinInPlay,
  canStartAssassination,
  canRerollOpening,
  currentMissionSize,
  currentRequiredFails,
  evilWins,
  goodWins,
  ladyDue,
  leaderId,
  nextLeaderIndex,
  playerById,
  voteApproved,
} from './fsm';

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function err(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } satisfies EngineError };
}

function ok(state: GameState, effects: Effect[] = []): EngineResult {
  return { ok: true, state, effects };
}

/** Structured clone of plain state so reducers never mutate their input. */
function clone(s: GameState): GameState {
  return structuredClone(s);
}

/** Append a public log entry to a (cloned) state. Mutates `s`. `at` stamped by reduce. */
function pushPublic(
  s: GameState,
  key: string,
  params?: Record<string, string | number>,
  style?: 'admin',
): void {
  s.logSeq += 1;
  s.logs.push({
    seq: s.logSeq,
    roundIndex: s.roundIndex,
    at: 0,
    channel: 'public',
    key,
    params,
    ...(style ? { style } : {}),
  });
}

/** Append a private log entry visible only to `audience`. Mutates `s`. */
function pushPrivate(
  s: GameState,
  audience: PlayerId,
  key: string,
  params?: Record<string, string | number>,
): void {
  s.logSeq += 1;
  s.logs.push({
    seq: s.logSeq,
    roundIndex: s.roundIndex,
    at: 0,
    channel: 'private',
    audience,
    key,
    params,
  });
}

/**
 * Public logs for the start of a new round: "mission X begins" + the first
 * proposal "mission X, proposal 1 begins — Y leads". Call when entering
 * TeamBuilding for a fresh round (rejectionCount reset to 0).
 */
function logRoundStart(s: GameState): void {
  pushPublic(s, 'roundBegins', { round: String(s.roundIndex + 1) });
  pushPublic(s, 'proposalBegins', {
    round: String(s.roundIndex + 1),
    proposal: String(s.rejectionCount + 1),
    leader: leaderId(s),
  });
}

/** Canonical display order for roles in the lineup announcement. */
const LINEUP_ROLE_ORDER: Role[] = [
  'Merlin',
  'Percival',
  'LoyalServant',
  'Morgana',
  'Mordred',
  'Oberon',
  'Assassin',
  'Minion',
];

/**
 * Encode a team's role multiset as a compact, locale-neutral string for a log
 * param, e.g. "Merlin,Percival,LoyalServant*3". The client decodes it and
 * localizes each role name (the engine has no locale). Roles appear in
 * canonical order; a count suffix is added only when >1.
 */
function encodeLineup(roles: Role[], team: Team): string {
  const counts = new Map<Role, number>();
  for (const r of roles) {
    if (teamOf(r) !== team) continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return LINEUP_ROLE_ORDER.filter((r) => counts.has(r))
    .map((r) => (counts.get(r)! > 1 ? `${r}*${counts.get(r)}` : r))
    .join(',');
}


export interface CreateGameInput {
  hostId: PlayerId;
  players: Array<{ id: PlayerId; name: string }>;
  options: GameOptions;
  seed: string;
}

export function createGame(input: CreateGameInput): EngineResult {
  const { players, options, seed } = input;
  const playerCount = players.length;

  if (!isValidPlayerCount(playerCount)) {
    return err('INVALID_PLAYER_COUNT', `Player count ${playerCount} not in 5..10`);
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) {
    return err('UNKNOWN_PLAYER', 'Duplicate player ids');
  }

  let roles;
  try {
    roles = buildRoleSet(playerCount, options);
  } catch (e) {
    return err('INVALID_ROLE_SET', (e as Error).message);
  }
  const valid = validateRoleSet(playerCount, roles);
  if (valid !== true) return err('INVALID_ROLE_SET', valid);

  const config: GameConfig = { playerCount, options, roles };

  // Seat players in given order; roles are assigned later (still Lobby here,
  // role fields are placeholders until assignRoles runs).
  const slots: PlayerSlot[] = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    seat: i,
    role: 'LoyalServant',
    connected: true,
  }));

  const state: GameState = {
    phase: 'Lobby',
    flowVersion: 5,
    discussion: null,
    actionTimers: [],
    config,
    seed,
    players: slots,
    roundIndex: 0,
    leaderIndex: 0,
    rejectionCount: 0,
    proposedTeam: null,
    votes: {},
    missionCards: {},
    missionResults: [],
    voteHistory: [],
    logs: [],
    logSeq: 0,
    roleAcks: [],
    roleRevision: 0,
    openingClosed: false,
    ladyEnabled: options.ladyOfTheLake,
    ladyHolderId: null,
    ladyInspectedIds: [],
    pendingLady: false,
    lastLadyResult: null,
    assassinId: null,
    outcome: null,
  };

  return ok(state);
}

// ---------------------------------------------------------------------------
// START_GAME → assign roles (seeded) → RoleReveal
// ---------------------------------------------------------------------------

function startGame(s: GameState, by: PlayerId, flowVersion: 1 | 2 | 3 | 4 | 5 = 5, assignedRoles?: Role[]): EngineResult {
  if (s.phase !== 'Lobby') return err('WRONG_PHASE', 'Game already started');
  // Host = seat 0 by convention (room layer enforces host identity too).
  if (s.players[0]?.id !== by) return err('NOT_HOST', 'Only the host can start');

  const rng = createRng(s.seed);
  // Consume the legacy shuffle to preserve the seeded leader stream and old replays.
  const ordinaryRoles = rng.shuffle(s.config.roles);
  const shuffledRoles = validRoleAssignment(s.config.roles, assignedRoles) ? assignedRoles : ordinaryRoles;
  if (shuffledRoles.length !== s.players.length) {
    return err('INVALID_ROLE_SET', 'Role count != player count at assignment');
  }

  const next = clone(s);
  next.flowVersion = flowVersion;
  next.players = next.players.map((p, i) => ({ ...p, role: shuffledRoles[i]! }));

  // Seeded first leader.
  next.leaderIndex = Math.floor(rng.next() * next.players.length);

  const assassin = next.players.find((p) => p.role === 'Assassin');
  next.assassinId = assassin ? assassin.id : null;

  if (next.ladyEnabled) {
    // First Lady holder sits to the right of the first leader.
    const n = next.players.length;
    const holderSeat = (next.leaderIndex - 1 + n) % n;
    const holder = next.players.find((p) => p.seat === holderSeat);
    next.ladyHolderId = holder ? holder.id : null;
  }

  next.phase = 'TeamBuilding';
  next.roleAcks = [];
  next.proposedTeam = null;

  // Logs: public game start + lineup; per-player private role + perception.
  pushPublic(next, 'gameStarted', { count: String(next.players.length) });
  pushPublic(next, 'lineup', {
    good: encodeLineup(next.config.roles, 'good'),
    evil: encodeLineup(next.config.roles, 'evil'),
  });
  logRoleKnowledge(next);
  // Role-viewing is now a per-player client overlay (gated on roleAcks), not a
  // global phase. The game opens directly in TeamBuilding so players who have
  // already acked can act without waiting for the rest. Log the first round here.
  logRoundStart(next);

  return ok(next, [{ kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_started' }]);
}

// ---------------------------------------------------------------------------
// ACK_ROLE → (all acked) TeamBuilding
// ---------------------------------------------------------------------------

function ackRole(s: GameState, by: PlayerId, roleRevision = 0): EngineResult {
  if (s.phase === 'Lobby') return err('WRONG_PHASE', 'Game has not started');
  if (!playerById(s, by)) return err('UNKNOWN_PLAYER', `Unknown player ${by}`);
  if (roleRevision !== (s.roleRevision ?? 0)) {
    return err('WRONG_PHASE', 'Roles were reassigned. View and confirm your new identity.');
  }

  // Acking only records that this player has seen their role. It no longer
  // gates a phase transition — role-viewing is a per-player client overlay, so
  // each player enters the game independently. Idempotent.
  if (s.roleAcks.includes(by)) return ok(s);

  const next = clone(s);
  next.roleAcks.push(by);
  return ok(next);
}

function logRoleKnowledge(s: GameState): void {
  for (const p of s.players) {
    pushPrivate(s, p.id, 'yourRole', { role: p.role });
    for (const k of computeKnownPlayers({ id: p.id, role: p.role }, s.players)) {
      pushPrivate(s, p.id, `perceive.${k.shownAs}`, { player: k.playerId });
    }
  }
}

function useRerollCard(s: GameState, by: PlayerId, roleRevision: number, ctx: EngineContext, assignedRoles?: Role[]): EngineResult {
  const player = playerById(s, by);
  if (!player) return err('UNKNOWN_PLAYER', 'Unknown player');
  if (!canRerollOpening(s) || s.roleAcks.includes(by) || roleRevision !== (s.roleRevision ?? 0)) {
    return err('WRONG_PHASE', 'Reroll is only available before confirming your current identity and the first proposal.');
  }
  // Sample the user's new role from the remaining role cards, then shuffle the
  // rest of the table. No rejection loop, and no identifiable two-player swap.
  const alternatives = s.config.roles.filter((role) => role !== player.role);
  if (!alternatives.length) return err('INVALID_ROLE_SET', 'No different identity available');
  const role = alternatives[Math.floor(ctx.rng.next() * alternatives.length)]!;
  const remaining = [...s.config.roles];
  remaining.splice(remaining.indexOf(role), 1);
  const shuffled = ctx.rng.shuffle(remaining);
  const next = clone(s);
  const supplied = validRoleAssignment(s.config.roles, assignedRoles)
    && assignedRoles[s.players.findIndex((p) => p.id === by)] !== player.role;
  next.players = next.players.map((p, i) => ({
    ...p, role: supplied ? assignedRoles[i]! : p.id === by ? role : shuffled.pop()!,
  }));
  next.assassinId = next.players.find((p) => p.role === 'Assassin')?.id ?? null;
  next.roleAcks = [];
  next.roleRevision = (s.roleRevision ?? 0) + 1;
  next.phaseRevision = (s.phaseRevision ?? 0) + 1;
  next.logs = next.logs.filter((log) => log.channel !== 'private' || (log.key !== 'yourRole' && !log.key.startsWith('perceive.')));
  pushPublic(next, 'rerollCardUsed', { player: by });
  logRoleKnowledge(next);
  return ok(next);
}

function rerollOpening(
  s: GameState,
  event: Extract<GameEvent, { type: 'REROLL_LEADER' | 'REROLL_ROLES' }>,
  ctx: EngineContext,
): EngineResult {
  if (!canRerollOpening(s)) {
    return err('WRONG_PHASE', 'Only available before the first proposal or assassination.');
  }
  const next = clone(s);
  // Invalidate local selections and dialogs even though the phase has not changed.
  next.phaseRevision = (s.phaseRevision ?? 0) + 1;
  if (event.type === 'REROLL_LEADER') {
    next.leaderIndex = next.players[Math.floor(ctx.rng.next() * next.players.length)]!.seat;
    if (next.ladyEnabled) {
      const holderSeat = (next.leaderIndex - 1 + next.players.length) % next.players.length;
      next.ladyHolderId = next.players.find((p) => p.seat === holderSeat)!.id;
    }
    pushPublic(next, 'admin.leaderRerolled', {
      actor: event.actor,
      seat: next.leaderIndex + 1,
    }, 'admin');
  } else {
    const ordinaryRoles = ctx.rng.shuffle(next.config.roles);
    const roles = validRoleAssignment(next.config.roles, event.assignedRoles) ? event.assignedRoles : ordinaryRoles;
    next.players = next.players.map((p, i) => ({ ...p, role: roles[i]! }));
    next.assassinId = next.players.find((p) => p.role === 'Assassin')?.id ?? null;
    next.roleAcks = [];
    next.roleRevision = (s.roleRevision ?? 0) + 1;
    // Old private knowledge is obsolete; retain public history and its monotonic sequence.
    next.logs = next.logs.filter((log) =>
      log.channel !== 'private' || (log.key !== 'yourRole' && !log.key.startsWith('perceive.')),
    );
    pushPublic(next, 'admin.rolesRerolled', { actor: event.actor }, 'admin');
    logRoleKnowledge(next);
  }
  return ok(next);
}

// ---------------------------------------------------------------------------
// PROPOSE_TEAM → public announcement; FINALIZE_TEAM → Voting
// ---------------------------------------------------------------------------

function proposeTeam(s: GameState, by: PlayerId, team: PlayerId[], admin = false, final = false): EngineResult {
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

function startDiscussion(s: GameState, by: PlayerId, direction: 'clockwise' | 'counterclockwise' = 'clockwise'): EngineResult {
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

function endSpeech(s: GameState, by: PlayerId, referee?: string): EngineResult {
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

function setTimersPaused(s: GameState, paused: boolean, actor: string): EngineResult {
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

function castVote(s: GameState, by: PlayerId, value: VoteValue, admin = false): EngineResult {
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

function retractVotes(s: GameState): EngineResult {
  if (s.phase !== 'Voting') return err('WRONG_PHASE', 'Not in Voting');
  const next = clone(s);
  next.votes = {};
  return ok(next);
}

// ---------------------------------------------------------------------------
// RETRACT_PROPOSAL (referee) → back to TeamBuilding, same leader re-proposes
// ---------------------------------------------------------------------------

function retractProposal(s: GameState): EngineResult {
  if (!['Voting', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing'].includes(s.phase))
    return err('WRONG_PHASE', 'No active proposal');
  const next = clone(s);
  next.proposedTeam = null;
  next.votes = {};
  next.phase = 'TeamBuilding';
  return ok(next);
}

// ---------------------------------------------------------------------------
// CAST_MISSION_CARD → (all in) MissionResult → route
// ---------------------------------------------------------------------------

function castMissionCard(s: GameState, by: PlayerId, card: MissionCard): EngineResult {
  if (s.phase !== 'MissionVote') return err('WRONG_PHASE', 'Not in MissionVote');
  if (!s.proposedTeam || !s.proposedTeam.includes(by)) {
    return err('NOT_ON_TEAM', 'Player is not on the mission team');
  }
  if (s.missionCards[by] !== undefined) return err('ALREADY_PLAYED_CARD', 'Already played a card');

  const player = playerById(s, by)!;
  if (card === 'fail' && isGood(player.role)) {
    return err('GOOD_CANNOT_FAIL', 'Blue team players must play success');
  }

  const next = clone(s);
  next.missionCards[by] = card;
  pushPrivate(next, by, card === 'fail' ? 'youPlayedFail' : 'youPlayedSuccess', {
    round: String(next.roundIndex + 1),
  });

  if (!allCardsIn(next)) return ok(next);

  // Tally.
  const team = next.proposedTeam!;
  const failCount = team.filter((id) => next.missionCards[id] === 'fail').length;
  const success = failCount < currentRequiredFails(next);
  // Snapshot the per-player cards onto the outcome before clearing, so the
  // persistence layer can record them (cards are never projected to clients
  // except in post-game replay).
  const cards: Record<PlayerId, MissionCard> = {};
  for (const id of team) cards[id] = next.missionCards[id]!;
  next.missionResults.push({
    roundIndex: next.roundIndex,
    teamSize: team.length,
    team: [...team],
    success,
    failCount,
    cards,
  });
  next.phase = 'MissionResult';
  next.missionCards = {};
  pushPublic(next, success ? 'missionSucceeded' : 'missionFailed', {
    round: String(next.roundIndex + 1),
    fails: String(failCount),
  });

  const effects: Effect[] = [{ kind: 'PERSIST_CHECKPOINT', checkpoint: 'mission_result' }];
  return routeAfterResult(next, effects);
}

// ---------------------------------------------------------------------------
// Routing after a mission result (T10–T14)
// ---------------------------------------------------------------------------

function routeAfterResult(next: GameState, effects: Effect[]): EngineResult {
  // Evil's 3rd fail ends immediately, even if Lady would otherwise trigger.
  if (evilWins(next) >= 3) {
    next.phase = 'GameOver';
    pushPublic(next, 'evilWinsMissions');
    next.outcome = buildOutcome(next, 'evil', 'three_missions');
    return ok(next, [...effects, { kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_over' }]);
  }

  if (goodWins(next) >= 3) {
    if (assassinInPlay(next)) {
      next.phase = 'Assassination';
      pushPublic(next, 'goodWinsMissionsAssassin');
      return ok(next, effects);
    }
    next.phase = 'GameOver';
    pushPublic(next, 'goodWinsMissions');
    next.outcome = buildOutcome(next, 'good', 'three_missions');
    return ok(next, [...effects, { kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_over' }]);
  }

  // Game continues.
  if (ladyDue(next)) {
    next.phase = 'LadyOfLake';
    next.pendingLady = true;
    pushPublic(next, 'ladyBegins', { holder: next.ladyHolderId ?? '' });
    return ok(next, effects);
  }

  advanceToNextRound(next);
  return ok(next, effects);
}

function advanceToNextRound(next: GameState): void {
  next.roundIndex += 1;
  next.leaderIndex = nextLeaderIndex(next);
  next.rejectionCount = 0;
  next.proposedTeam = null;
  next.votes = {};
  next.phase = 'TeamBuilding';
  logRoundStart(next);
}

// ---------------------------------------------------------------------------
// USE_LADY → reveal loyalty to holder, pass token, next round
// ---------------------------------------------------------------------------

function applyLadyOfLake(s: GameState, by: PlayerId, target: PlayerId): EngineResult {
  if (s.phase !== 'LadyOfLake') return err('WRONG_PHASE', 'Not in LadyOfLake');
  if (s.ladyHolderId !== by) return err('NOT_LADY_HOLDER', 'Only the Lady holder may inspect');
  if (target === by) return err('LADY_TARGET_SELF', 'Cannot inspect yourself');
  if (s.ladyInspectedIds.includes(target)) {
    return err('LADY_TARGET_INSPECTED', 'Target already inspected');
  }
  const targetPlayer = playerById(s, target);
  if (!targetPlayer) return err('INVALID_TEAM_MEMBER', `Unknown target ${target}`);

  const next = clone(s);
  const loyalty = teamOf(targetPlayer.role);

  next.ladyInspectedIds.push(by); // current holder can't be re-inspected later
  next.lastLadyResult = { holderId: by, targetId: target, loyalty };
  next.ladyHolderId = target;
  next.pendingLady = false;
  pushPublic(next, 'ladyInspected', { holder: by, target });
  pushPrivate(next, by, loyalty === 'evil' ? 'ladyResultEvil' : 'ladyResultGood', { target });

  advanceToNextRound(next);

  return ok(next, [
    { kind: 'PERSIST_CHECKPOINT', checkpoint: 'lady' },
    { kind: 'PRIVATE_LADY', holderId: by, targetId: target, loyalty },
  ]);
}

// ---------------------------------------------------------------------------
// START_ASSASSINATION → abandon unfinished decisions, enter Assassination
// ---------------------------------------------------------------------------

function startAssassination(s: GameState, by: PlayerId, admin = false, actor?: string): EngineResult {
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

/** Capture gameplay only: identities, connections, role acknowledgements and
 * the audit log remain current when a referee rewinds. */
function phaseCheckpoint(s: GameState): PhaseCheckpoint {
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

function previousPhase(s: GameState, actor: string): EngineResult {
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
// ASSASSINATE → GameOver
// ---------------------------------------------------------------------------

function assassinate(s: GameState, by: PlayerId, target: PlayerId): EngineResult {
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

function buildOutcome(
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

// ---------------------------------------------------------------------------
// Connection flag (never alters game logic)
// ---------------------------------------------------------------------------

function setConnected(s: GameState, by: PlayerId, connected: boolean): EngineResult {
  const p = playerById(s, by);
  if (!p) return err('UNKNOWN_PLAYER', `Unknown player ${by}`);
  const next = clone(s);
  const slot = next.players.find((x) => x.id === by)!;
  slot.connected = connected;
  return ok(next);
}

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

function dispatch(state: GameState, event: GameEvent, ctx: EngineContext): EngineResult {
  switch (event.type) {
    case 'START_GAME':
      return startGame(state, event.by, event.flowVersion, event.assignedRoles);
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
