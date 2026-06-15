/**
 * Official Avalon player-count configuration tables.
 * Frozen constant data — the backbone the rest of the engine validates against.
 */

export const PLAYER_COMPOSITION: Record<number, { good: number; evil: number }> = {
  5: { good: 3, evil: 2 },
  6: { good: 4, evil: 2 },
  7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 },
  9: { good: 6, evil: 3 },
  10: { good: 6, evil: 4 },
};

/** Team size required for each of the 5 missions, per player count. */
export const MISSION_TEAM_SIZE: Record<number, readonly [number, number, number, number, number]> =
  {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };

/**
 * Number of fail cards needed to FAIL each mission, per player count.
 * The only non-1 cells: mission 4 (index 3) needs 2 fails for 7+ players.
 */
export const REQUIRED_FAILS: Record<number, readonly [number, number, number, number, number]> = {
  5: [1, 1, 1, 1, 1],
  6: [1, 1, 1, 1, 1],
  7: [1, 1, 1, 2, 1],
  8: [1, 1, 1, 2, 1],
  9: [1, 1, 1, 2, 1],
  10: [1, 1, 1, 2, 1],
};

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export const MISSION_COUNT = 5;

export function isValidPlayerCount(count: number): boolean {
  return Number.isInteger(count) && count >= MIN_PLAYERS && count <= MAX_PLAYERS;
}

export function missionSize(count: number, roundIndex0: number): number {
  const sizes = MISSION_TEAM_SIZE[count];
  if (!sizes) throw new Error(`No mission sizes for player count ${count}`);
  const size = sizes[roundIndex0];
  if (size === undefined) throw new Error(`No mission size for round ${roundIndex0}`);
  return size;
}

export function requiredFails(count: number, roundIndex0: number): number {
  const fails = REQUIRED_FAILS[count];
  if (!fails) throw new Error(`No required-fails for player count ${count}`);
  const need = fails[roundIndex0];
  if (need === undefined) throw new Error(`No required-fails for round ${roundIndex0}`);
  return need;
}

export function missionSizesFor(count: number): number[] {
  return [...(MISSION_TEAM_SIZE[count] ?? [])];
}

export function requiredFailsFor(count: number): number[] {
  return [...(REQUIRED_FAILS[count] ?? [])];
}
