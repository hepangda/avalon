import type { ClientGameState, ClientMissionResult, VoteValue } from '@/lib/engine';

export interface MatrixProposal {
  key: string;
  proposalIndex: number;
  leaderId: string | null;
  team: string[];
  /** Null while the proposal is still on the table. */
  votes: Map<string, VoteValue> | null;
  approved: boolean | null;
}

export interface MatrixRound {
  roundIndex: number;
  size: number;
  requiredFails: number;
  proposals: MatrixProposal[];
  result: ClientMissionResult | null;
}

const OPEN_PHASES = new Set(['TeamBuilding', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing', 'Voting']);

/** Every nomination so far, grouped by mission, with the one still being decided last. */
export function buildVoteMatrix(game: Pick<ClientGameState,
  'voteHistory' | 'missionResults' | 'config' | 'phase' | 'roundIndex' | 'rejectionCount' | 'leaderIndex' | 'proposedTeam' | 'players'>,
): MatrixRound[] {
  const open = OPEN_PHASES.has(game.phase);
  const last = Math.max(
    open ? game.roundIndex : -1,
    ...game.voteHistory.map((v) => v.roundIndex),
    ...game.missionResults.map((m) => m.roundIndex),
  );
  const rounds: MatrixRound[] = [];
  for (let roundIndex = 0; roundIndex <= last; roundIndex++) {
    const proposals: MatrixProposal[] = game.voteHistory
      .filter((v) => v.roundIndex === roundIndex)
      .sort((a, b) => a.proposalIndex - b.proposalIndex)
      .map((v) => ({
        key: `${roundIndex}-${v.proposalIndex}`,
        proposalIndex: v.proposalIndex,
        leaderId: v.leaderId,
        team: v.team,
        votes: new Map(v.votes.map((vote) => [vote.playerId, vote.vote])),
        approved: v.approved,
      }));
    if (open && roundIndex === game.roundIndex && !proposals.some((p) => p.proposalIndex === game.rejectionCount)) {
      proposals.push({
        key: `${roundIndex}-${game.rejectionCount}`,
        proposalIndex: game.rejectionCount,
        leaderId: game.players.find((p) => p.seat === game.leaderIndex)?.id ?? null,
        team: game.phase === 'TeamBuilding' ? [] : game.proposedTeam ?? [],
        votes: null,
        approved: null,
      });
    }
    rounds.push({
      roundIndex,
      size: game.config.missionSizes[roundIndex] ?? 0,
      requiredFails: game.config.requiredFails[roundIndex] ?? 1,
      proposals,
      result: game.missionResults.find((m) => m.roundIndex === roundIndex) ?? null,
    });
  }
  return rounds;
}
