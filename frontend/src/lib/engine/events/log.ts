import {
  leaderId
} from '../fsm';
import { ROLE_ORDER, teamOf } from '../roles';
import type {
  GameState,
  PlayerId,
  Role,
  Team
} from '../types';
import { computeKnownPlayers } from '../visibility';

/** Append a public log entry to a (cloned) state. Mutates `s`. `at` stamped by reduce. */
export function pushPublic(
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
export function pushPrivate(
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
export function logRoundStart(s: GameState): void {
  pushPublic(s, 'roundBegins', { round: String(s.roundIndex + 1) });
  pushPublic(s, 'proposalBegins', {
    round: String(s.roundIndex + 1),
    proposal: String(s.rejectionCount + 1),
    leader: leaderId(s),
  });
}

/**
 * Encode a team's role multiset as a compact, locale-neutral string for a log
 * param, e.g. "Merlin,Percival,LoyalServant*3". The client decodes it and
 * localizes each role name (the engine has no locale). Roles appear in
 * canonical order; a count suffix is added only when >1.
 */
export function encodeLineup(roles: Role[], team: Team): string {
  const counts = new Map<Role, number>();
  for (const r of roles) {
    if (teamOf(r) !== team) continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return ROLE_ORDER.filter((r) => counts.has(r))
    .map((r) => (counts.get(r)! > 1 ? `${r}*${counts.get(r)}` : r))
    .join(',');
}

export function logRoleKnowledge(s: GameState): void {
  for (const p of s.players) {
    pushPrivate(s, p.id, 'yourRole', { role: p.role });
    for (const k of computeKnownPlayers({ id: p.id, role: p.role }, s.players)) {
      pushPrivate(s, p.id, `perceive.${k.shownAs}`, { player: k.playerId });
    }
  }
}
