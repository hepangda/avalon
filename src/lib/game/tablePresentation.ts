import type {
  ClientGameState,
  ClientMissionResult,
  ClientVoteRecord,
  MissionCard,
  Role,
} from '@/lib/engine';

export type TablePresentation =
  | { id: string; kind: 'vote'; record: ClientVoteRecord }
  | {
      id: string;
      kind: 'mission';
      result: ClientMissionResult;
      team: string[];
    }
  | {
      id: string;
      kind: 'assassination';
      target: { id: string; seat: number; name: string; role: Role; roleVariant?: number };
      hitMerlin: boolean;
    };

export interface TablePresentationState {
  game: ClientGameState | null;
  queue: Array<{
    presentation: TablePresentation;
    reportGame: ClientGameState;
  }>;
}

/** Hold the entire report before a reveal, including logs caused by its outcome. */
export function tablePresentationReducer(
  state: TablePresentationState,
  action:
    | { type: 'sync'; game: ClientGameState | null }
    | { type: 'finish'; id: string },
): TablePresentationState {
  if (action.type === 'finish') {
    return state.queue[0]?.presentation.id === action.id
      ? { ...state, queue: state.queue.slice(1) }
      : state;
  }
  const previous = state.game;
  const game = action.game;
  if (!game || !previous || !sameTimeline(previous, game))
    return { game, queue: [] };
  return {
    game,
    queue: [
      ...state.queue,
      ...newTablePresentations(previous, game).map((presentation) => ({
        presentation,
        reportGame: previous,
      })),
    ],
  };
}

/** A room reset/rollback starts a new presentation timeline. */
export function sameTimeline(a: ClientGameState, b: ClientGameState): boolean {
  return (
    a.gameId === b.gameId &&
    a.phaseRevision === b.phaseRevision &&
    a.voteHistory.length <= b.voteHistory.length &&
    a.missionResults.length <= b.missionResults.length
  );
}

export function newTablePresentations(
  previous: ClientGameState | null,
  next: ClientGameState,
): TablePresentation[] {
  if (!previous || !sameTimeline(previous, next)) return [];
  const prefix = `${next.gameId}-${next.phaseRevision ?? 0}`;
  const events: Exclude<TablePresentation, { kind: 'assassination' }>[] = next.voteHistory
    .slice(previous.voteHistory.length)
    .map((record) => ({
      id: `${prefix}-vote-${record.roundIndex}-${record.proposalIndex}`,
      kind: 'vote',
      record,
    }));
  for (const result of next.missionResults.slice(
    previous.missionResults.length,
  )) {
    // Team membership is public. The result has counts, never an owner/card mapping.
    const vote = next.voteHistory.find(
      (v) => v.roundIndex === result.roundIndex && v.approved,
    );
    events.push({
      id: `${prefix}-mission-${result.roundIndex}`,
      kind: 'mission',
      result,
      team:
        vote?.team ??
        (previous.roundIndex === result.roundIndex
          ? (previous.proposedTeam ?? [])
          : []),
    });
  }
  const ordered: TablePresentation[] = events.sort((a, b) => {
    const roundA =
      a.kind === 'vote' ? a.record.roundIndex : a.result.roundIndex;
    const roundB =
      b.kind === 'vote' ? b.record.roundIndex : b.result.roundIndex;
    return (
      roundA - roundB || (a.kind === b.kind ? 0 : a.kind === 'vote' ? -1 : 1)
    );
  });
  const outcome = next.outcome;
  if (
    !previous.outcome && next.phase === 'GameOver' && outcome &&
    (outcome.reason === 'assassinated_merlin' || outcome.reason === 'assassin_missed')
  ) {
    const target = next.players.find((p) => p.id === outcome.assassinTargetId);
    const role = outcome.revealedRoles.find((p) => p.playerId === target?.id)?.role;
    if (target && role) {
      ordered.push({
        id: `${prefix}-assassination-${target.id}`,
        kind: 'assassination',
        target: { id: target.id, seat: target.seat, name: target.name, role, roleVariant: target.roleVariant },
        hitMerlin: outcome.reason === 'assassinated_merlin',
      });
    }
  }
  return ordered;
}

export function anonymousMissionCards(
  teamSize: number,
  failCount: number,
  random = Math.random,
): MissionCard[] {
  const cards: MissionCard[] = Array.from({ length: teamSize }, (_, i) =>
    i < failCount ? 'fail' : 'success',
  );
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}

export function arrangeSeats<T extends { id: string; seat: number }>(
  players: T[],
  viewerId: string | null,
) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  if (!ordered.length) return { top: [] as T[], bottom: [] as T[] };
  const anchor = Math.max(
    0,
    ordered.findIndex((p) => p.id === viewerId),
  );
  const bottomCount = Math.ceil(ordered.length / 2);
  const start =
    (anchor - Math.floor((bottomCount - 1) / 2) + ordered.length) %
    ordered.length;
  const loop = ordered.map((_, i) => ordered[(start + i) % ordered.length]!);
  return {
    top: loop.slice(bottomCount).reverse(),
    bottom: loop.slice(0, bottomCount),
  };
}
