import type { GameEvent, GameOptions, GameState, Role } from '@/lib/engine';
import { applyEvent, createGame } from './rustEngine';

export const DEFAULT_OPTIONS: GameOptions = {
  oberon: false,
  mordred: false,
  morgana: false,
  percival: false,
  ladyOfTheLake: false,
};

/** Standard 5-player good-heavy role list with explicit positions. */
export const FIVE_P: Role[] = [
  'Merlin',
  'Percival',
  'LoyalServant',
  'Morgana',
  'Assassin',
];

/**
 * Start a game on the Rust engine with an EXPLICIT role assignment so tests are
 * deterministic. Players are p0..p(n-1) seated in order; p0 hosts and leads.
 * The optional roles in `roles` decide the deck, which must suit the player count.
 */
export function buildStartedGame(roles: Role[], opts?: Partial<GameOptions>): GameState {
  const options: GameOptions = {
    ...DEFAULT_OPTIONS,
    percival: roles.includes('Percival'),
    morgana: roles.includes('Morgana'),
    mordred: roles.includes('Mordred'),
    oberon: roles.includes('Oberon'),
    ...opts,
  };
  const lobby = createGame({
    hostId: 'p0',
    players: roles.map((_, i) => ({ id: `p${i}`, name: `Player ${i}` })),
    options,
    seed: 'test-seed',
  });
  return applyEvent(lobby, {
    type: 'START_GAME',
    by: 'p0',
    assignedRoles: roles,
    leaderIndex: 0,
  });
}

/** Complete a real discussion when a test needs to exercise the vote/mission rules. */
export function proposeForVote(
  state: GameState,
  event: Extract<GameEvent, { type: 'PROPOSE_TEAM' }>,
): GameState {
  state = applyEvent(state, event);
  if (state.phase === 'TeamAnnouncement')
    state = applyEvent(state, { type: 'START_DISCUSSION', by: event.by });
  for (const by of state.discussion!.order) state = applyEvent(state, { type: 'END_SPEECH', by });
  return applyEvent(state, { type: 'FINALIZE_TEAM', by: event.by, team: event.team });
}
