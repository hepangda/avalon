/**
 * Public surface of the Avalon game engine.
 * The Socket layer should import from here.
 */
export * from './types';
export {
  PLAYER_COMPOSITION,
  MISSION_TEAM_SIZE,
  REQUIRED_FAILS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MISSION_COUNT,
  isValidPlayerCount,
  missionSize,
  requiredFails,
  missionSizesFor,
  requiredFailsFor,
} from './config';
export {
  ROLE_TEAM,
  teamOf,
  isEvil,
  isGood,
  buildRoleSet,
  validateRoleSet,
} from './roles';
export { createRng } from './rng';
export { computeKnownPlayers } from './visibility';
export {
  goodWins,
  evilWins,
  assassinInPlay,
  leaderId,
  currentMissionSize,
  currentRequiredFails,
} from './fsm';
export { createGame, reduce } from './reducer';
export type { CreateGameInput } from './reducer';
export { projectStateForViewer } from './projection';
export {
  RECOMMENDED_OPTIONS,
  recommendedOptions,
  previewRoles,
  evilSpecialsCount,
  maxEvil,
} from './presets';
