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
  RevealedRole,
  Role,
  Team,
  VoteValue,
} from './types';
import { isValidPlayerCount } from './config';
import { buildRoleSet, isGood, teamOf, validateRoleSet } from './roles';
import { computeKnownPlayers } from './visibility';
import { createRng } from './rng';
import {
  allCardsIn,
  allVotesIn,
  assassinInPlay,
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

function startGame(s: GameState, by: PlayerId): EngineResult {
  if (s.phase !== 'Lobby') return err('WRONG_PHASE', 'Game already started');
  // Host = seat 0 by convention (room layer enforces host identity too).
  if (s.players[0]?.id !== by) return err('NOT_HOST', 'Only the host can start');

  const rng = createRng(s.seed);
  const shuffledRoles = rng.shuffle(s.config.roles);
  if (shuffledRoles.length !== s.players.length) {
    return err('INVALID_ROLE_SET', 'Role count != player count at assignment');
  }

  const next = clone(s);
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
  for (const p of next.players) {
    pushPrivate(next, p.id, 'yourRole', { role: p.role });
    const known = computeKnownPlayers({ id: p.id, role: p.role }, next.players);
    for (const k of known) {
      pushPrivate(next, p.id, `perceive.${k.shownAs}`, { player: k.playerId });
    }
  }
  // Role-viewing is now a per-player client overlay (gated on roleAcks), not a
  // global phase. The game opens directly in TeamBuilding so players who have
  // already acked can act without waiting for the rest. Log the first round here.
  logRoundStart(next);

  return ok(next, [{ kind: 'PERSIST_CHECKPOINT', checkpoint: 'game_started' }]);
}

// ---------------------------------------------------------------------------
// ACK_ROLE → (all acked) TeamBuilding
// ---------------------------------------------------------------------------

function ackRole(s: GameState, by: PlayerId): EngineResult {
  if (s.phase === 'Lobby') return err('WRONG_PHASE', 'Game has not started');
  if (!playerById(s, by)) return err('UNKNOWN_PLAYER', `Unknown player ${by}`);

  // Acking only records that this player has seen their role. It no longer
  // gates a phase transition — role-viewing is a per-player client overlay, so
  // each player enters the game independently. Idempotent.
  if (s.roleAcks.includes(by)) return ok(s);

  const next = clone(s);
  next.roleAcks.push(by);
  return ok(next);
}

// ---------------------------------------------------------------------------
// PROPOSE_TEAM → Voting
// ---------------------------------------------------------------------------

function proposeTeam(s: GameState, by: PlayerId, team: PlayerId[], admin = false): EngineResult {
  if (s.phase !== 'TeamBuilding') return err('WRONG_PHASE', 'Not in TeamBuilding');
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
  next.proposedTeam = [...team];
  next.votes = {};
  next.phase = 'Voting';
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
  if (next.rejectionCount >= 4) {
    // This was the 5th consecutive rejection → evil wins (hammer).
    next.phase = 'GameOver';
    pushPublic(next, 'hammerEvilWins');
    next.outcome = buildOutcome(next, 'evil', 'five_rejections');
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
    return err('GOOD_CANNOT_FAIL', 'Good players must play success');
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
// ASSASSINATE → GameOver
// ---------------------------------------------------------------------------

function assassinate(s: GameState, by: PlayerId, target: PlayerId): EngineResult {
  if (s.phase !== 'Assassination') return err('WRONG_PHASE', 'Not in Assassination');
  if (s.assassinId !== by) return err('NOT_ASSASSIN', 'Only the assassin may act');

  const targetPlayer = playerById(s, target);
  if (!targetPlayer) return err('ASSASSIN_TARGET_INVALID', `Unknown target ${target}`);
  if (target === by) return err('ASSASSIN_TARGET_INVALID', 'Cannot target self');
  if (teamOf(targetPlayer.role) !== 'good') {
    return err('ASSASSIN_TARGET_INVALID', 'Target must be on the good team');
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
  const result = dispatch(state, event);
  // Stamp the wall-clock time on any log entries created during this reduce
  // (push helpers leave `at: 0`). Keeps the engine pure — time is injected.
  if (result.ok) {
    for (const log of result.state.logs) {
      if (log.at === 0) log.at = ctx.now;
    }
  }
  return result;
}

function dispatch(state: GameState, event: GameEvent): EngineResult {
  switch (event.type) {
    case 'START_GAME':
      return startGame(state, event.by);
    case 'ACK_ROLE':
      return ackRole(state, event.by);
    case 'PROPOSE_TEAM':
      return proposeTeam(state, event.by, event.team, event.admin ?? false);
    case 'CAST_VOTE':
      return castVote(state, event.by, event.value, event.admin ?? false);
    case 'CAST_MISSION_CARD':
      return castMissionCard(state, event.by, event.card);
    case 'USE_LADY':
      return applyLadyOfLake(state, event.by, event.target);
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
