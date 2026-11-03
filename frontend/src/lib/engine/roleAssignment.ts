import type { Role } from './types';

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
