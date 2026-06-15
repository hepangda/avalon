import type { GameOptions, Role } from './types';
import { PLAYER_COMPOSITION } from './config';
import { buildRoleSet } from './roles';

/**
 * Official recommended optional-role setups per player count (from the Avalon
 * rulebook's suggested configurations). These are the "one-click recommended"
 * presets offered in the lobby. Lady of the Lake is a separate module toggle,
 * left off by default here.
 */
export const RECOMMENDED_OPTIONS: Record<number, GameOptions> = {
  5: { percival: true, morgana: true, mordred: false, oberon: false, ladyOfTheLake: false },
  6: { percival: true, morgana: true, mordred: false, oberon: false, ladyOfTheLake: false },
  7: { percival: true, morgana: true, oberon: true, mordred: false, ladyOfTheLake: false },
  8: { percival: true, morgana: true, mordred: true, oberon: false, ladyOfTheLake: false },
  9: { percival: true, morgana: true, mordred: true, oberon: false, ladyOfTheLake: false },
  10: { percival: true, morgana: true, mordred: true, oberon: true, ladyOfTheLake: false },
};

export function recommendedOptions(playerCount: number): GameOptions {
  return (
    RECOMMENDED_OPTIONS[playerCount] ?? {
      percival: true,
      morgana: true,
      mordred: false,
      oberon: false,
      ladyOfTheLake: false,
    }
  );
}

/**
 * Preview the full role list a given player count + options will produce, or an
 * error string if the optional roles don't fit the evil/good budget.
 */
export function previewRoles(
  playerCount: number,
  options: GameOptions,
): { ok: true; roles: Role[] } | { ok: false; error: string } {
  try {
    return { ok: true, roles: buildRoleSet(playerCount, options) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** How many evil special roles are currently selected (excludes plain Minion). */
export function evilSpecialsCount(options: GameOptions): number {
  return (options.morgana ? 1 : 0) + (options.mordred ? 1 : 0) + (options.oberon ? 1 : 0) + 1; // +Assassin
}

/** Max evil specials that fit for a player count (= evil slots). */
export function maxEvil(playerCount: number): number {
  return PLAYER_COMPOSITION[playerCount]?.evil ?? 0;
}
