import {
  createGame,
  createRng,
  reduce,
  teamOf,
  type CheckpointKind,
  type GameEvent,
  type GameOptions,
  type GameState,
} from '@/lib/engine';
import type { ReplayData, ReplayLadyCheck, ReplayRound } from '@/lib/game/replayTypes';
import { roleVariants } from '@/lib/engine/roleVariants';

/** Builds the public completed replay from the private deterministic event log. */

interface SeatedPlayer {
  id: string;
  name: string;
}

interface EventInput {
  seq: number;
  event: GameEvent;
  createdAt: number;
}

class ReplayBuilder {
  private readonly rounds = new Map<number, ReplayRound>();
  private readonly ladyChecks: ReplayLadyCheck[] = [];
  private assassination: ReplayData['assassination'] = null;

  copy(): ReplayBuilder {
    const copy = new ReplayBuilder();
    for (const [index, round] of this.rounds) copy.rounds.set(index, structuredClone(round));
    copy.ladyChecks.push(...structuredClone(this.ladyChecks));
    copy.assassination = structuredClone(this.assassination);
    return copy;
  }

  onCheckpoint(kind: CheckpointKind, prev: GameState | null, s: GameState): void {
    switch (kind) {
      case 'vote':
        this.onVote(prev, s);
        break;
      case 'mission_result':
        this.onMissionResult(prev, s);
        break;
      case 'lady':
        this.onLady(s);
        break;
      case 'game_over':
        this.onGameOver(s);
        break;
      case 'game_started':
        break;
    }
  }

  /** Mirrors the `vote` checkpoint: create the round on its first proposal
   *  (leader/teamSize from that proposal), then append every proposal's votes. */
  private onVote(_prev: GameState | null, s: GameState): void {
    const record = s.voteHistory.at(-1);
    if (!record) return;
    const roundIndex = record.roundIndex;
    const proposalTeam = record.team;
    const votes = record.votes;
    const leader = record.leaderId;

    const round = this.ensureRound(roundIndex, leader, proposalTeam.length, proposalTeam);
    const proposalIndex = record.proposalIndex;
    for (const [playerId, value] of Object.entries(votes)) {
      round.votes.push({ proposalIndex, playerId, value });
    }
  }

  /** Mirrors the `mission_result` checkpoint: stamp the round's final approved
   *  team + outcome + per-player cards. */
  private onMissionResult(prev: GameState | null, s: GameState): void {
    const result = s.missionResults.at(-1);
    if (!result) return;
    const leaderSeat = (prev ?? s).leaderIndex;
    const leader = (prev ?? s).players.find((p) => p.seat === leaderSeat)?.id ?? '';

    const round = this.ensureRound(result.roundIndex, leader, result.teamSize, result.team);
    round.approved = true;
    round.missionSuccess = result.success;
    round.failCount = result.failCount;
    round.finalTeam = result.team;
    round.teamSize = result.teamSize;

    const cards = result.cards ?? {};
    for (const playerId of result.team) {
      const card = cards[playerId];
      if (card !== undefined) round.missionCards.push({ playerId, card });
    }
  }

  private onLady(s: GameState): void {
    const r = s.lastLadyResult;
    if (!r) return;
    this.ladyChecks.push({
      roundIndex: s.roundIndex,
      holderPlayerId: r.holderId,
      targetPlayerId: r.targetId,
      revealedTeam: r.loyalty,
    });
  }

  private onGameOver(s: GameState): void {
    if (!s.outcome) return;
    if (s.outcome.assassinTargetId && s.assassinId) {
      const target = s.players.find((p) => p.id === s.outcome!.assassinTargetId);
      this.assassination = {
        assassinPlayerId: s.assassinId,
        targetPlayerId: s.outcome.assassinTargetId,
        hitMerlin: target ? teamOf(target.role) === 'good' && target.role === 'Merlin' : false,
      };
    }
  }

  /** Create the round once; later checkpoints update only their own result fields. */
  private ensureRound(
    roundIndex: number,
    leaderPlayerId: string,
    teamSize: number,
    finalTeam: string[],
  ): ReplayRound {
    let round = this.rounds.get(roundIndex);
    if (!round) {
      round = {
        roundIndex,
        leaderPlayerId,
        teamSize,
        finalTeam,
        approved: null,
        missionSuccess: null,
        failCount: null,
        votes: [],
        missionCards: [],
      };
      this.rounds.set(roundIndex, round);
    }
    return round;
  }

  build(gameId: string, finalState: GameState): ReplayData {
    const variants = roleVariants(finalState);
    return {
      gameId,
      outcome: finalState.outcome,
      roleAssignments: finalState.players.map((p) => ({
        playerId: p.id,
        role: p.role,
        ...(variants[p.id] !== undefined ? { roleVariant: variants[p.id] } : {}),
      })),
      players: finalState.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      rounds: [...this.rounds.values()].sort((a, b) => a.roundIndex - b.roundIndex),
      ladyChecks: this.ladyChecks,
      assassination: this.assassination,
    };
  }
}

/** Replay a game's event log into its full ReplayData. Returns null if the log
 *  can't be replayed (inconsistent). */
export function buildReplayFromEvents(
  gameId: string,
  seed: string,
  options: GameOptions,
  seatedPlayers: SeatedPlayer[],
  events: EventInput[],
): ReplayData | null {
  const created = createGame({
    hostId: seatedPlayers[0]?.id ?? '',
    players: seatedPlayers,
    options,
    seed,
  });
  if (!created.ok) return null;

  let state = created.state;
  let builder = new ReplayBuilder();
  const history: ReplayBuilder[] = [];
  for (const { seq, event, createdAt } of events) {
    const ctx = { now: createdAt, rng: createRng(`${seed}:${seq}`) };
    const replayEvent = event.type === 'START_GAME' ? { ...event, flowVersion: event.flowVersion ?? 1 as const } : event;
    const result = reduce(state, replayEvent, ctx);
    if (!result.ok) return null;
    if (event.type === 'PREVIOUS_PHASE') {
      const previous = history.pop();
      if (!previous) return null;
      builder = previous;
    } else if (state.phase !== 'Lobby' && result.state.phase !== state.phase) {
      history.push(builder.copy());
    }
    const prev = state;
    state = result.state;
    for (const effect of result.effects) {
      if (effect.kind === 'PERSIST_CHECKPOINT') builder.onCheckpoint(effect.checkpoint, prev, state);
    }
  }
  return builder.build(gameId, state);
}
