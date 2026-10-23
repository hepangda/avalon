import type { ClientGameState } from '@/lib/engine';
import { actionAvailability } from './actionAvailability';

export type TurnKind =
  | 'role' | 'team' | 'startDiscussion' | 'speech' | 'finalize'
  | 'vote' | 'mission' | 'lady' | 'assassinate' | 'assassinationBallot';

/** What the table is waiting on this viewer to do, if anything. */
export function myTurn(game: ClientGameState, playerId: string | null): TurnKind | null {
  if (!playerId || game.isSpectator || game.phase === 'GameOver' || game.phase === 'Lobby') return null;
  if (!game.roleAcks.includes(playerId)) return 'role';
  if (game.rolesPending) return null;
  const ballot = game.earlyAssassination;
  if (ballot?.voterIds.includes(playerId) && !ballot.votes[playerId]) return 'assassinationBallot';
  const leader = game.players.find((p) => p.seat === game.leaderIndex)?.id === playerId;
  const { canVote, canMission } = actionAvailability(game, playerId);
  switch (game.phase) {
    case 'TeamBuilding': return leader ? 'team' : null;
    case 'TeamAnnouncement': return leader ? 'startDiscussion' : null;
    case 'TeamFinalizing': return leader ? 'finalize' : null;
    case 'Discussion':
      return game.discussion?.order[game.discussion.speakerIndex] === playerId ? 'speech' : null;
    case 'Voting': return canVote ? 'vote' : null;
    case 'MissionVote': return canMission ? 'mission' : null;
    case 'LadyOfLake': return game.lady?.holderId === playerId ? 'lady' : null;
    case 'Assassination': return game.assassinCandidates ? 'assassinate' : null;
    default: return null;
  }
}

export function isMyTurn(game: ClientGameState, playerId: string | null): boolean {
  return myTurn(game, playerId) !== null;
}

/**
 * Identifies one turn, so a new one alerts even when the kind repeats (the next proposal, a redeal),
 * while updates inside the same turn (other players' votes arriving) do not.
 */
export function turnAlertKey(game: ClientGameState, playerId: string | null): string | null {
  const kind = myTurn(game, playerId);
  if (!kind) return null;
  const stamp = kind === 'role' ? game.roleRevision
    : kind === 'assassinationBallot' ? game.earlyAssassination?.id
    : kind === 'speech' ? game.discussion?.speakerIndex
    : `${game.rejectionCount}`;
  return `${game.gameId}:${game.phaseRevision ?? 0}:${game.roundIndex}:${game.phase}:${kind}:${stamp}`;
}
