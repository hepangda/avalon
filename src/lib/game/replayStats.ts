import type { Team } from '@/lib/engine';
import { teamOf } from '@/lib/engine';
import type { ReplayData } from './replayTypes';

/**
 * Per-player performance metrics derived purely from replay data. Definitions:
 *
 * - voteAccuracy: among APPROVED missions the player voted on, the fraction
 *   where their vote aligned with their team's interest. A good player "should"
 *   approve a team that ends up succeeding and reject one that fails; an evil
 *   player benefits from the inverse. Computed only over the final (approved)
 *   proposal of each round, where the mission outcome is known. null if the
 *   player cast no such votes.
 *
 * - missionParticipation: fraction of the played missions (rounds with a
 *   recorded outcome) the player was a member of the team.
 *
 * - contribution: faction-specific impact, 0..1-ish.
 *     · evil: fail cards they played / number of missions they were on
 *       (capped at 1) — how reliably they sabotaged when given the chance.
 *     · good: missions they were on that SUCCEEDED / missions they were on —
 *       how often their presence coincided with a clean quest.
 */
export interface PlayerStats {
  playerId: string;
  name: string;
  team: Team;
  voteAccuracy: number | null;
  missionParticipation: number;
  contribution: number | null;
  onTeamCount: number;
  failsPlayed: number;
}

export interface ReplayStats {
  players: PlayerStats[];
  /** Player id with the highest blended score, or null if undeterminable. */
  mvpPlayerId: string | null;
}

export function computeReplayStats(replay: ReplayData): ReplayStats {
  const roleOf = new Map(replay.roleAssignments.map((r) => [r.playerId, r.role]));
  const teamOfPlayer = (id: string): Team => {
    const role = roleOf.get(id);
    return role ? teamOf(role) : 'good';
  };

  // Only rounds that actually played a mission (have an outcome).
  const playedRounds = replay.rounds.filter((r) => r.missionSuccess !== null);
  const totalPlayed = playedRounds.length;

  const players: PlayerStats[] = replay.players.map((p) => {
    const team = teamOfPlayer(p.id);

    // Mission participation.
    const onTeamRounds = playedRounds.filter((r) => (r.finalTeam ?? []).includes(p.id));
    const onTeamCount = onTeamRounds.length;
    const missionParticipation = totalPlayed > 0 ? onTeamCount / totalPlayed : 0;

    // Fails played by this player.
    let failsPlayed = 0;
    for (const r of playedRounds) {
      const card = r.missionCards.find((c) => c.playerId === p.id);
      if (card?.card === 'fail') failsPlayed++;
    }

    // Vote accuracy over the final (approved) proposal of each played round.
    let voteHits = 0;
    let voteTotal = 0;
    for (const r of playedRounds) {
      if (r.approved !== true || r.missionSuccess === null) continue;
      // The final proposal's votes share the highest proposalIndex in the round.
      const maxIdx = r.votes.reduce((m, v) => Math.max(m, v.proposalIndex), 0);
      const myVote = r.votes.find((v) => v.playerId === p.id && v.proposalIndex === maxIdx);
      if (!myVote) continue;
      voteTotal++;
      const success = r.missionSuccess === true;
      // Good wants success → approving a successful mission (or rejecting a
      // failed one) is "accurate". Evil is the inverse.
      const goodAccurate =
        (success && myVote.value === 'approve') || (!success && myVote.value === 'reject');
      const accurate = team === 'good' ? goodAccurate : !goodAccurate;
      if (accurate) voteHits++;
    }
    const voteAccuracy = voteTotal > 0 ? voteHits / voteTotal : null;

    // Contribution.
    let contribution: number | null;
    if (team === 'evil') {
      contribution = onTeamCount > 0 ? Math.min(1, failsPlayed / onTeamCount) : null;
    } else {
      const successesOn = onTeamRounds.filter((r) => r.missionSuccess === true).length;
      contribution = onTeamCount > 0 ? successesOn / onTeamCount : null;
    }

    return {
      playerId: p.id,
      name: p.name,
      team,
      voteAccuracy,
      missionParticipation,
      contribution,
      onTeamCount,
      failsPlayed,
    };
  });

  // MVP: blend of vote accuracy, participation, and contribution (each treated
  // as 0 when null), lightly weighting the winning team.
  const winner = replay.outcome?.winner ?? null;
  let mvpPlayerId: string | null = null;
  let bestScore = -1;
  for (const s of players) {
    const score =
      (s.voteAccuracy ?? 0) * 0.4 +
      s.missionParticipation * 0.3 +
      (s.contribution ?? 0) * 0.3 +
      (winner && s.team === winner ? 0.15 : 0);
    if (score > bestScore) {
      bestScore = score;
      mvpPlayerId = s.playerId;
    }
  }

  return { players, mvpPlayerId };
}
