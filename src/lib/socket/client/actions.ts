import type { RoomConfig } from '../types';
import { emitWithAck } from './socket';

/** Thin typed wrappers around emitWithAck for room/game actions. */
export const roomActions = {
  config: (config: RoomConfig) =>
    emitWithAck('room:config', { config }),
  rename: (name: string) =>
    emitWithAck('room:rename', { name }),
  addBot: () => emitWithAck('room:addBot', {}),
  kick: (targetPlayerId: string) =>
    emitWithAck('room:kick', { targetPlayerId }),
  claimSeat: (seatId?: string, name?: string, avatarUrl?: string) =>
    emitWithAck('room:claimSeat', {
      seatId,
      ...(name?.trim() ? { name } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    }),
  releaseSeat: () =>
    emitWithAck('room:releaseSeat', {}),
  setRoster: (names: string[]) =>
    emitWithAck('room:setRoster', { names }),
  start: () => emitWithAck('room:start', {}),
  restart: () => emitWithAck('room:restart', {}),
  removeSeat: (seatId: string) =>
    emitWithAck('room:removeSeat', { seatId }),
  leave: () => emitWithAck('room:leave', {}),
};

/** Game-phase action wrappers. */
export const gameActions = {
  useRerollCard: (roleRevision: number) =>
    emitWithAck('game:useRerollCard', { roleRevision }),
  ackRole: (roleRevision = 0) =>
    emitWithAck('game:ackRole', { roleRevision }),
  proposeTeam: (team: string[]) =>
    emitWithAck('game:proposeTeam', { team }),
  finalizeTeam: (team: string[]) =>
    emitWithAck('game:finalizeTeam', { team }),
  startDiscussion: (direction: 'clockwise' | 'counterclockwise' = 'clockwise') =>
    emitWithAck('game:startDiscussion', { direction }),
  endSpeech: () =>
    emitWithAck('game:endSpeech', {}),
  vote: (value: 'approve' | 'reject') =>
    emitWithAck('game:vote', { value }),
  missionCard: (card: 'success' | 'fail') =>
    emitWithAck('game:missionCard', {
      card,
    }),
  useLady: (targetPlayerId: string) =>
    emitWithAck('game:useLady', {
      targetPlayerId,
    }),
  startAssassination: () =>
    emitWithAck('game:startAssassination', {}),
  assassinate: (targetPlayerId: string) =>
    emitWithAck('game:assassinate', {
      targetPlayerId,
    }),
};

/** Referee (admin) action wrappers. */
export const adminActions = {
  setTimersPaused: (paused: boolean) =>
    emitWithAck('admin:setTimersPaused', { paused }),
  skipSpeech: (targetPlayerId: string) =>
    emitWithAck('admin:skipSpeech', { targetPlayerId }),
  rerollLeader: () =>
    emitWithAck('admin:rerollLeader', {}),
  rerollRoles: () =>
    emitWithAck('admin:rerollRoles', {}),
  startAssassination: () =>
    emitWithAck('admin:startAssassination', {}),
  previousPhase: () =>
    emitWithAck('admin:previousPhase', {}),
  auth: () =>
    emitWithAck('admin:auth', {}),
  close: () => emitWithAck('admin:close', {}),
  unbind: (targetPlayerId: string) =>
    emitWithAck('admin:unbind', {
      targetPlayerId,
    }),
  vote: (targetPlayerId: string, value: 'approve' | 'reject') =>
    emitWithAck(
      'admin:vote',
      { targetPlayerId, value },
    ),
  propose: (targetPlayerId: string, team: string[]) =>
    emitWithAck('admin:propose', {
      targetPlayerId,
      team,
    }),
  retractVotes: () =>
    emitWithAck('admin:retractVotes', {}),
  retractProposal: () =>
    emitWithAck('admin:retractProposal', {}),
};
