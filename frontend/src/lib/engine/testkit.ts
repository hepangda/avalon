import type {
  GameOptions,
  GameState,
  PlayerId,
  PlayerSlot,
  Role,
  EngineContext,
  GameEvent,
} from './types';
import { teamOf } from './roles';
import { buildRoleSet } from './roles';
import { missionSize } from './config';
import { reduce } from './reducer';
import { createRng } from './rng';

export const DEFAULT_OPTIONS: GameOptions = {
  oberon: false,
  mordred: false,
  morgana: false,
  percival: false,
  ladyOfTheLake: false,
};

/**
 * Build a started game (phase RoleReveal-equivalent, ready for play) with an
 * EXPLICIT role assignment, bypassing the shuffle so rule tests are
 * deterministic. Players are p0..p(n-1) seated in order; p0 is host.
 */
export function buildStartedGame(roles: Role[], opts?: Partial<GameOptions>): GameState {
  const options: GameOptions = { ...DEFAULT_OPTIONS, ...opts };
  const n = roles.length;
  const players: PlayerSlot[] = roles.map((role, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    seat: i,
    role,
    connected: true,
  }));
  const assassin = players.find((p) => p.role === 'Assassin');

  const state: GameState = {
    phase: 'TeamBuilding',
    config: { playerCount: n, options, roles: [...roles] },
    seed: 'test-seed',
    players,
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
    ladyHolderId: options.ladyOfTheLake ? `p${n - 1}` : null,
    ladyInspectedIds: [],
    pendingLady: false,
    lastLadyResult: null,
    assassinId: assassin ? assassin.id : null,
    outcome: null,
  };
  return state;
}

export function ids(state: GameState): PlayerId[] {
  return state.players.map((p) => p.id);
}

/** First `k` player ids — convenient team picker. */
export function firstK(state: GameState, k: number): PlayerId[] {
  return ids(state).slice(0, k);
}

export function teamForCurrentMission(state: GameState): PlayerId[] {
  const size = missionSize(state.config.playerCount, state.roundIndex);
  return firstK(state, size);
}

export function evilIds(state: GameState): PlayerId[] {
  return state.players.filter((p) => teamOf(p.role) === 'evil').map((p) => p.id);
}

/** Standard 5-player good-heavy role list with explicit positions. */
export const FIVE_P: Role[] = [
  'Merlin',
  'Percival',
  'LoyalServant',
  'Morgana',
  'Assassin',
];

export { buildRoleSet };

/** Complete a real discussion when a test needs to exercise the vote/mission rules. */
export function proposeForVote(state: GameState, event: Extract<GameEvent, { type: 'PROPOSE_TEAM' }>,
  ctx: EngineContext = { now: 1, rng: createRng('discussion-test') }): GameState {
  const step = (event: GameEvent) => {
    const result = reduce(state, event, ctx);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  };
  step(event);
  if (state.phase === 'TeamAnnouncement') step({ type: 'START_DISCUSSION', by: event.by });
  for (const by of state.discussion!.order) step({ type: 'END_SPEECH', by });
  step({ type: 'FINALIZE_TEAM', by: event.by, team: event.team });
  return state;
}
