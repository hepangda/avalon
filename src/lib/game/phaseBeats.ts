import type { ClientGameState, GamePhase } from '@/lib/engine';

/**
 * Short table beats between phases. They are derived from successive settled
 * states only, never queued: a newer state simply replaces the beat in play.
 */
export type PhaseBeat =
  /** A new quest opens: its medallion grows out of the track and settles back. */
  | { kind: 'round'; roundIndex: number; size: number; needsTwo: boolean }
  /** The crown leaves the old leader's portrait for the new one. */
  | { kind: 'crown'; from: string; to: string }
  /** A named team: each portrait leaves its seat for the middle of the felt. */
  | { kind: 'team'; team: string[] }
  /** Ballots open: every voting place lights in turn, from the leader around. */
  | { kind: 'ballots'; order: string[] }
  /** The quest leaves: the team's card places light in turn. */
  | { kind: 'quest'; order: string[] };

export interface PhaseBeatSet {
  id: string;
  beats: PhaseBeat[];
}

export interface BeatSnapshot {
  timeline: string;
  roundIndex: number;
  phase: GamePhase;
  leaderId: string | undefined;
  team: string;
  /** Seen before the viewer's own role was acknowledged, i.e. the table is not yet open. */
  opening: boolean;
}

export function beatSnapshot(game: ClientGameState, held: boolean): BeatSnapshot {
  return {
    timeline: `${game.gameId}-${game.phaseRevision ?? 0}`,
    roundIndex: game.roundIndex,
    phase: game.phase,
    leaderId: game.players.find((p) => p.seat === game.leaderIndex)?.id,
    team: (game.proposedTeam ?? []).join(','),
    opening: held && game.roundIndex === 0 && game.voteHistory.length === 0,
  };
}

/** Seats in table order, starting from the given player. */
function aroundFrom(game: ClientGameState, startId: string | undefined, ids?: string[]) {
  const seated = [...game.players].sort((a, b) => a.seat - b.seat);
  const start = Math.max(0, seated.findIndex((p) => p.id === startId));
  return seated
    .map((_, i) => seated[(start + i) % seated.length]!.id)
    .filter((id) => !ids || ids.includes(id));
}

const TEAM_PHASES: GamePhase[] = ['TeamAnnouncement', 'Discussion', 'Voting'];

/** The beats that carry a settled table from `previous` to `game`. */
export function phaseBeats(previous: BeatSnapshot | null, next: BeatSnapshot, game: ClientGameState): PhaseBeat[] {
  if (!previous || previous.timeline !== next.timeline || next.phase === 'GameOver') return [];
  const beats: PhaseBeat[] = [];
  const opened = previous.opening && !next.opening;
  if (next.roundIndex > previous.roundIndex || (opened && next.phase === 'TeamBuilding')) {
    beats.push({
      kind: 'round',
      roundIndex: next.roundIndex,
      size: game.config.missionSizes[next.roundIndex] ?? 0,
      needsTwo: game.config.requiredFails[next.roundIndex] === 2,
    });
  }
  if (previous.leaderId && next.leaderId && previous.leaderId !== next.leaderId)
    beats.push({ kind: 'crown', from: previous.leaderId, to: next.leaderId });
  const team = game.proposedTeam ?? [];
  if (team.length && next.team !== previous.team && TEAM_PHASES.includes(next.phase))
    beats.push({ kind: 'team', team });
  if (next.phase !== previous.phase) {
    if (next.phase === 'Voting') beats.push({ kind: 'ballots', order: aroundFrom(game, next.leaderId) });
    if (next.phase === 'MissionVote') beats.push({ kind: 'quest', order: aroundFrom(game, next.leaderId, team) });
  }
  return beats;
}
