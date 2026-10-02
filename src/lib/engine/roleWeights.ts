import type { RNG, Role } from './types';
import { ROLE_TEAM } from './roles';

export const ALL_ROLES = Object.keys(ROLE_TEAM) as Role[];
export type RoleWeights = Record<Role, number>;
export const DEFAULT_ROLE_WEIGHT = 100;
export const ROLE_WEIGHT_STEP = 25;
export const MIN_ROLE_WEIGHT = 50;

export function normalizeRoleWeights(raw: unknown): RoleWeights {
  const stored = raw && typeof raw === 'object' ? raw as Partial<RoleWeights> : {};
  return Object.fromEntries(ALL_ROLES.map((role) => {
    const weight = stored[role];
    return [role, typeof weight === 'number' && Number.isFinite(weight) && weight > 0
      ? Math.max(MIN_ROLE_WEIGHT, weight) : DEFAULT_ROLE_WEIGHT];
  })) as RoleWeights;
}

/** The deltas are based on the original 100, never on the current weight. */
export function settledRoleWeights(raw: unknown, playedRole: Role): RoleWeights {
  const weights = normalizeRoleWeights(raw);
  for (const role of ALL_ROLES) {
    weights[role] = role === playedRole
      ? Math.max(MIN_ROLE_WEIGHT, weights[role] - ROLE_WEIGHT_STEP)
      : weights[role] + ROLE_WEIGHT_STEP;
  }
  return weights;
}

export function validRoleAssignment(deck: readonly Role[], candidate: unknown): candidate is Role[] {
  if (!Array.isArray(candidate) || candidate.length !== deck.length) return false;
  const remaining = new Map<Role, number>();
  for (const role of deck) remaining.set(role, (remaining.get(role) ?? 0) + 1);
  for (const role of candidate) {
    const count = remaining.get(role) ?? 0;
    if (!count) return false;
    remaining.set(role, count - 1);
  }
  return true;
}

/** Sample legal complete deals proportional to the product of player/role weights.
 * Card slots keep the configured multiset intact, including duplicate servants.
 * Log probabilities avoid overflow/underflow even for very large valid weights.
 */
export function weightedRoleAssignment(
  players: readonly { id: string }[],
  deck: readonly Role[],
  weights: Readonly<Record<string, unknown>>,
  rng: Pick<RNG, 'next'>,
  excluded?: { playerId: string; role: Role },
): Role[] | null {
  if (players.length !== deck.length || players.length > 10) return null;
  const matrix = players.map((player) => {
    const normalized = normalizeRoleWeights(weights[player.id]);
    return deck.map((role) => excluded?.playerId === player.id && excluded.role === role
      ? -Infinity : Math.log(normalized[role]));
  });
  const full = (1 << deck.length) - 1;
  const memo = new Map<number, number>();
  const sumLogs = (values: number[]) => {
    const max = Math.max(...values);
    return max === -Infinity ? -Infinity : max + Math.log(values.reduce((sum, value) => sum + Math.exp(value - max), 0));
  };
  function total(used: number, player: number): number {
    if (used === full) return 0;
    const cached = memo.get(used);
    if (cached !== undefined) return cached;
    const branches: number[] = [];
    for (let i = 0; i < deck.length; i++) {
      if (!(used & (1 << i))) branches.push(matrix[player]![i]! + total(used | (1 << i), player + 1));
    }
    const result = sumLogs(branches);
    memo.set(used, result);
    return result;
  }
  if (!Number.isFinite(total(0, 0))) return null;
  const roles: Role[] = [];
  let used = 0;
  for (let player = 0; player < players.length; player++) {
    const branches = deck.map((_, i) => used & (1 << i) ? -Infinity
      : matrix[player]![i]! + total(used | (1 << i), player + 1));
    const max = Math.max(...branches);
    const masses = branches.map((value) => Math.exp(value - max));
    const random = rng.next();
    let ticket = (Number.isFinite(random) && random >= 0 && random < 1 ? random : 0)
      * masses.reduce((sum, value) => sum + value, 0);
    let selected = -1;
    for (let i = 0; i < deck.length; i++) {
      if (!masses[i]) continue;
      selected = i; // A final rounding residue still selects a valid branch.
      if (ticket < masses[i]!) break;
      ticket -= masses[i]!;
    }
    if (selected < 0) return null;
    roles.push(deck[selected]!);
    used |= 1 << selected;
  }
  return validRoleAssignment(deck, roles) ? roles : null;
}
