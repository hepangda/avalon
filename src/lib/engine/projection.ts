import type {
  ClientGameState,
  ClientMissionResult,
  ClientPlayer,
  ClientVote,
  GameState,
  PlayerId,
  Role,
} from './types';
import { missionSizesFor, requiredFailsFor } from './config';
import { teamOf } from './roles';
import { computeKnownPlayers } from './visibility';

/**
 * Project full authoritative state into the per-viewer client view.
 *
 * Security core: the server holds full state; this is the ONLY path to the
 * wire. Default-deny — build each field explicitly, never serialize raw state.
 *
 * `viewerId` may be a seated player or a spectator (not in players → spectator).
 */
export function projectStateForViewer(state: GameState, viewerId: PlayerId): ClientGameState {
  const self = state.players.find((p) => p.id === viewerId) ?? null;
  const isSpectator = self === null;
  const isGameOver = state.phase === 'GameOver';

  const leaderSeatPlayer = state.players.find((p) => p.seat === state.leaderIndex);
  const leaderPlayerId = leaderSeatPlayer?.id ?? null;

  // Players: roles only for self (pre-GameOver) or everyone (GameOver).
  const players: ClientPlayer[] = state.players.map((p) => {
    const showRole = isGameOver || (self !== null && p.id === self.id);
    return {
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.connected,
      ...(showRole ? { role: p.role } : {}),
      isLeader: p.id === leaderPlayerId,
      isLadyHolder: state.ladyEnabled && p.id === state.ladyHolderId,
    };
  });

  // Known players (curated visibility) — never raw roles. Spectators get none.
  const knownPlayers =
    self !== null && !isGameOver
      ? computeKnownPlayers({ id: self.id, role: self.role }, state.players)
      : [];

  // Votes: reveal individual votes only once all are in; otherwise just who voted.
  let votes: ClientVote[] | null = null;
  if (state.phase === 'Voting' || state.phase === 'MissionVote' || state.proposedTeam) {
    const allIn = Object.keys(state.votes).length === state.players.length;
    votes = state.players.map((p) => {
      const hasVoted = state.votes[p.id] !== undefined;
      const v = state.votes[p.id];
      return {
        playerId: p.id,
        hasVoted,
        ...(allIn && v ? { vote: v } : {}),
      };
    });
  }

  // Mission results: counts only; never per-player cards.
  const missionResults: ClientMissionResult[] = state.missionResults.map((m) => ({
    roundIndex: m.roundIndex,
    success: m.success,
    failCount: m.failCount,
    teamSize: m.teamSize,
  }));

  // Vote history: every completed proposal (approved or rejected). Public —
  // Avalon votes are open once cast — so all viewers (incl. spectators) get it.
  const voteHistory = state.voteHistory.map((v) => ({
    roundIndex: v.roundIndex,
    proposalIndex: v.proposalIndex,
    leaderId: v.leaderId,
    team: [...v.team],
    approved: v.approved,
    votes: Object.entries(v.votes).map(([playerId, vote]) => ({ playerId, vote })),
  }));

  // Logs: public entries to everyone; private entries only to their audience.
  // The audience field is stripped before sending.
  const logs = state.logs
    .filter((l) => l.channel === 'public' || l.audience === viewerId)
    .map((l) => ({
      seq: l.seq,
      roundIndex: l.roundIndex,
      at: l.at,
      channel: l.channel,
      key: l.key,
      ...(l.params ? { params: l.params } : {}),
      ...(l.style ? { style: l.style } : {}),
    }));

  const selfRole: Role | null = self !== null ? self.role : null;

  const lady = state.ladyEnabled
    ? {
        holderId: state.ladyHolderId,
        inspectedIds: [...state.ladyInspectedIds],
        pending: state.pendingLady,
      }
    : null;

  // Private Lady result: only to the holder who just inspected.
  let privateLadyResult: ClientGameState['privateLadyResult'];
  if (
    self !== null &&
    state.lastLadyResult !== null &&
    state.lastLadyResult.holderId === self.id
  ) {
    privateLadyResult = {
      targetId: state.lastLadyResult.targetId,
      loyalty: state.lastLadyResult.loyalty,
    };
  }

  // Assassin candidates: only the assassin during Assassination sees the list
  // of valid (good-team) targets — but as ids only, not their roles.
  let assassinCandidates: PlayerId[] | undefined;
  if (state.phase === 'Assassination' && self !== null && state.assassinId === self.id) {
    assassinCandidates = state.players
      .filter((p) => teamOf(p.role) === 'good')
      .map((p) => p.id);
  }

  return {
    phase: state.phase,
    roundIndex: state.roundIndex,
    leaderIndex: state.leaderIndex,
    rejectionCount: state.rejectionCount,
    players,
    selfRole,
    knownPlayers,
    roleAcks: [...state.roleAcks],
    proposedTeam: state.proposedTeam ? [...state.proposedTeam] : null,
    votes,
    missionResults,
    voteHistory,
    logs,
    config: {
      playerCount: state.config.playerCount,
      missionSizes: missionSizesFor(state.config.playerCount),
      requiredFails: requiredFailsFor(state.config.playerCount),
      rolesInPlay: [...state.config.roles],
    },
    lady,
    ...(privateLadyResult ? { privateLadyResult } : {}),
    ...(assassinCandidates ? { assassinCandidates } : {}),
    outcome: isGameOver ? state.outcome : null,
    isSpectator,
    gameId: null,
  };
}
