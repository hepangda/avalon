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
  rejectionLimit,
  speechDuration,
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
  buildRoleSet,
} from './roles';
export { createRng } from './rng';
export { computeKnownPlayers } from './visibility';
export {
  RECOMMENDED_OPTIONS,
  recommendedOptions,
  previewRoles,
  evilSpecialsCount,
  maxEvil,
} from './presets';
export { speakingOrder } from './speakingOrder';
