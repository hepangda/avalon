import type { ClientGameState } from '@/lib/engine';
import { ROLE_TEAM_UI } from './roleMeta';

/** A refresh, seat transfer, or referee retraction reads the same authoritative flags. */
export function actionAvailability(
  game: ClientGameState,
  playerId: string | null,
) {
  const seated = !!playerId && !game.isSpectator;
  return {
    canVote:
      seated &&
      game.phase === 'Voting' &&
      !game.votes?.some((v) => v.playerId === playerId && v.hasVoted),
    canMission:
      seated &&
      game.phase === 'MissionVote' &&
      !!game.proposedTeam?.includes(playerId) &&
      !game.missionSubmissions?.includes(playerId),
    canFail:
      seated && !!game.selfRole && ROLE_TEAM_UI[game.selfRole] === 'evil',
  };
}
