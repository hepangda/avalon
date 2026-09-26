import type {
  ClientGameState,
  ClientMissionResult,
  ClientPlayer,
  ClientVote,
  GameState,
  PlayerId,
  Role,
} from './types';
import { missionSizesFor, requiredFailsFor, rejectionLimit } from './config';
import { canRerollOpening, canStartAssassination } from './fsm';
import { teamOf } from './roles';
import { computeKnownPlayers } from './visibility';
import { roleVariants } from './roleVariants';

/**
 * Project full authoritative state into the per-viewer client view.
 *
 * Security core: the server holds full state; this is the ONLY path to the
 * wire. Default-deny — build each field explicitly, never serialize raw state.
 *
 * `viewerId` may be a seated player or a spectator (not in players → spectator).
 */
export function projectStateForViewer(
  state: GameState,
  viewerId: PlayerId,
): ClientGameState {
  const self = state.players.find((p) => p.id === viewerId) ?? null;
  const isSpectator = self === null;
  const isGameOver = state.phase === 'GameOver';
  const isAssassination = state.phase === 'Assassination';

  const leaderSeatPlayer = state.players.find(
    (p) => p.seat === state.leaderIndex,
  );
  const leaderPlayerId = leaderSeatPlayer?.id ?? null;

  const variants = roleVariants(state);
  // Own role and art are private; evil roles become public at Assassination, all at GameOver.
  const players: ClientPlayer[] = state.players.map((p) => {
    const showRole =
      isGameOver ||
      (self !== null && p.id === self.id) ||
      (isAssassination && teamOf(p.role) === 'evil');
    return {
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.connected,
      ...(showRole ? { role: p.role } : {}),
      ...(showRole && p.role === 'LoyalServant' ? { roleVariant: variants[p.id] } : {}),
      isLeader: p.id === leaderPlayerId,
      isLadyHolder: state.ladyEnabled && p.id === state.ladyHolderId,
    };
  });

  // Keep each player's original perception available even after the game ends.
  // Only red teammates receive exact ally roles; spectators get no perception.
  const knownPlayers =
    self !== null
      ? computeKnownPlayers({ id: self.id, role: self.role }, state.players)
      : [];

  // Votes: reveal individual votes only once all are in; otherwise just who voted.
  let votes: ClientVote[] | null = null;
  if (
    state.phase === 'Voting' ||
    state.phase === 'MissionVote' ||
    state.proposedTeam
  ) {
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
  const missionResults: ClientMissionResult[] = state.missionResults.map(
    (m) => ({
      roundIndex: m.roundIndex,
      success: m.success,
      failCount: m.failCount,
      teamSize: m.teamSize,
    }),
  );

  // Vote history: every completed proposal (approved or rejected). Public —
  // Avalon votes are open once cast — so all viewers (incl. spectators) get it.
  const voteHistory = state.voteHistory.map((v) => ({
    roundIndex: v.roundIndex,
    proposalIndex: v.proposalIndex,
    leaderId: v.leaderId,
    team: [...v.team],
    approved: v.approved,
    votes: Object.entries(v.votes).map(([playerId, vote]) => ({
      playerId,
      vote,
    })),
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
  if (isAssassination && self !== null && state.assassinId === self.id) {
    assassinCandidates = state.players
      .filter((p) => teamOf(p.role) === 'good')
      .map((p) => p.id);
  }

  return {
    phase: state.phase,
    discussion: state.discussion ? { ...state.discussion, order: [...state.discussion.order] } : null,
    actionTimers: (state.actionTimers ?? []).map((timer) => ({ ...timer })),
    previousPhase: state.phaseHistory?.at(-1)?.phase,
    phaseRevision: state.phaseRevision ?? 0,
    roleRevision: state.roleRevision ?? 0,
    canRerollOpening: canRerollOpening(state),
    roundIndex: state.roundIndex,
    leaderIndex: state.leaderIndex,
    rejectionCount: state.rejectionCount,
    players,
    selfRole,
    knownPlayers,
    roleAcks: [...state.roleAcks],
    proposedTeam: state.proposedTeam ? [...state.proposedTeam] : null,
    votes,
    missionSubmissions:
      state.phase === 'MissionVote'
        ? (state.proposedTeam ?? []).filter(
            (id) => state.missionCards[id] !== undefined,
          )
        : [],
    missionResults,
    voteHistory,
    logs,
    config: {
      playerCount: state.config.playerCount,
      missionSizes: missionSizesFor(state.config.playerCount),
      requiredFails: requiredFailsFor(state.config.playerCount),
      rolesInPlay: [...state.config.roles],
      maxRejections: rejectionLimit(state.config.options.maxRejections),
      speechSeconds: state.config.options.speechSeconds ?? 120,
    },
    lady,
    ...(privateLadyResult ? { privateLadyResult } : {}),
    canStartAssassination:
      self !== null &&
      state.assassinId === self.id &&
      canStartAssassination(state),
    ...(assassinCandidates ? { assassinCandidates } : {}),
    outcome: isGameOver ? state.outcome : null,
    isSpectator,
    gameId: null,
  };
}
