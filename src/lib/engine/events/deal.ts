import { isValidPlayerCount } from '../config';
import {
  canRerollOpening,
  playerById
} from '../fsm';
import { createRng } from '../rng';
import { buildRoleSet, validateRoleSet } from '../roles';
import { validRoleAssignment } from '../roleWeights';
import type {
  EngineContext,
  EngineResult,
  GameConfig,
  GameEvent,
  GameOptions,
  GameState,
  PlayerId,
  PlayerSlot,
  Role
} from '../types';
import { encodeLineup, logRoleKnowledge, logRoundStart, pushPublic } from './log';
import { clone, err, ok } from './result';

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

export function startGame(s: GameState, by: PlayerId, flowVersion: 1 | 2 | 3 | 4 | 5 = 5, assignedRoles?: Role[]): EngineResult {
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

export function ackRole(s: GameState, by: PlayerId, roleRevision = 0): EngineResult {
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

export function useRerollCard(s: GameState, by: PlayerId, roleRevision: number, ctx: EngineContext, assignedRoles?: Role[]): EngineResult {
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

export function rerollOpening(
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
