import type {
  ClientGameState,
  ClientMissionResult,
  ClientVoteRecord,
  GameOutcome,
  MissionCard,
  Role,
  Team,
} from '@/lib/engine';

export type TablePresentation =
  | { id: string; kind: 'vote'; record: ClientVoteRecord }
  | {
      id: string;
      kind: 'mission';
      result: ClientMissionResult;
      team: string[];
      /** Fail cards this quest needed to fall. */
      requiredFails: number;
    }
  | {
      id: string;
      kind: 'assassination';
      target: { id: string; seat: number; name: string; role: Role; roleVariant?: number };
      hitMerlin: boolean;
    }
  | {
      id: string;
      kind: 'gameOver';
      outcome: GameOutcome;
      /** Seats in the order their identities turn over. */
      order: string[];
    }
  | {
      id: string;
      kind: 'lady';
      holderId: string;
      targetId: string;
      roundIndex: number;
      /** Only the holder ever learns it. */
      loyalty?: Team;
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
  const events: Extract<TablePresentation, { kind: 'vote' | 'mission' }>[] = next.voteHistory
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
      requiredFails: next.config.requiredFails[result.roundIndex] ?? 1,
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
  // The token changes hands the moment it is used.
  const holderId = previous.lady?.holderId;
  const targetId = next.lady?.holderId;
  if (previous.phase === 'LadyOfLake' && holderId && targetId && holderId !== targetId) {
    const result = next.privateLadyResult?.targetId === targetId ? next.privateLadyResult : undefined;
    ordered.push({
      id: `${prefix}-lady-${previous.roundIndex}`,
      kind: 'lady',
      holderId,
      targetId,
      roundIndex: previous.roundIndex,
      ...(result ? { loyalty: result.loyalty } : {}),
    });
  }
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
  // Every ending closes on the identities, after whatever decided it has played.
  if (!previous.outcome && next.phase === 'GameOver' && outcome) {
    ordered.push({
      id: `${prefix}-gameOver`,
      kind: 'gameOver',
      outcome,
      order: endingRevealOrder(next),
    });
  }
  return ordered;
}

/** Whether the ending's own title card plays; an assassination already announced the winner. */
export function endingHasTitleCard(outcome: Pick<GameOutcome, 'reason'>) {
  return outcome.reason !== 'assassinated_merlin' && outcome.reason !== 'assassin_missed';
}

/** How a seat's identity card is marked when the ending turns it over. */
export type EndingMark =
  /** Merlin, struck down by the assassin. */
  | 'slain'
  /** The assassin whose blade found Merlin. */
  | 'killer'
  /** The loyal seat the assassin mistook for Merlin. */
  | 'spared'
  /** The assassin whose blade missed. */
  | 'foiled'
  /** Merlin, unrecognized to the end. */
  | 'survivor';

/** Marks only an assassination earns; other endings turn every seat the same way. */
export function endingMarks(outcome: Pick<GameOutcome, 'reason' | 'assassinTargetId' | 'revealedRoles'>) {
  const marks: Record<string, EndingMark> = {};
  if (endingHasTitleCard(outcome)) return marks;
  const hit = outcome.reason === 'assassinated_merlin';
  for (const { playerId, role } of outcome.revealedRoles) {
    if (playerId === outcome.assassinTargetId) marks[playerId] = hit ? 'slain' : 'spared';
    else if (role === 'Assassin') marks[playerId] = hit ? 'killer' : 'foiled';
    else if (role === 'Merlin' && !hit) marks[playerId] = 'survivor';
  }
  return marks;
}

/**
 * When each part of the ending happens, in ms. `title` is measured from the start,
 * `flips` and `settle` from the moment the seats start turning, `done` from the settle.
 * Each turn waits a beat; the change of side waits longer, and Merlin longest of all.
 * After an assassination the dagger's seat and the assassin come first and get the long
 * beats, and the losing side then goes over in a quick cascade.
 */
export function endingTimeline(
  event: Pick<Extract<TablePresentation, { kind: 'gameOver' }>, 'order' | 'outcome'>,
  reduceMotion = false,
) {
  if (reduceMotion)
    return { title: endingHasTitleCard(event.outcome) ? 1600 : 0, flips: [], settle: 0, done: 400 };
  const roles = new Map(event.outcome.revealedRoles.map((r) => [r.playerId, r]));
  const marks = endingMarks(event.outcome);
  const assassination = !endingHasTitleCard(event.outcome);
  const flips: number[] = [];
  let at = 350;
  event.order.forEach((id, i) => {
    const role = roles.get(id);
    const before = i > 0 ? roles.get(event.order[i - 1]!) : undefined;
    if (i > 0) {
      const sideChange = before?.team !== role?.team;
      if (assassination) {
        at += marks[id] === 'survivor' ? 1500
          : marks[id] === 'killer' || marks[id] === 'foiled' ? 1050
          : marks[event.order[i - 1]!] ? 750
          : sideChange ? 650
          : role?.team !== event.outcome.winner ? 240 : 380;
      } else at += role?.role === 'Merlin' ? 1100 : sideChange ? 800 : 380;
    }
    flips.push(at);
  });
  return { title: 2900, flips, settle: at + (marks[event.order.at(-1) ?? ''] === 'survivor' ? 1400 : 900), done: 1500 };
}

/**
 * Red seats first, then blue, and Merlin last of all; seat order within each.
 * After an assassination the story starts at the dagger: its target, then the assassin.
 * A hit then shows the rest of the red side before the fallen blue side; a miss keeps
 * Merlin, who was never found, for last.
 */
export function endingRevealOrder(game: Pick<ClientGameState, 'players' | 'outcome'>): string[] {
  const outcome = game.outcome;
  const roles = new Map(outcome?.revealedRoles.map((r) => [r.playerId, r]));
  const marks = outcome ? endingMarks(outcome) : {};
  const rank = (id: string, role = roles.get(id)) =>
    marks[id] === 'slain' || marks[id] === 'spared' ? -2
      : marks[id] === 'killer' || marks[id] === 'foiled' ? -1
      : role?.role === 'Merlin' ? 2 : role?.team === 'evil' ? 0 : 1;
  return [...game.players]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.seat - b.seat)
    .map((p) => p.id);
}

/**
 * When each beat of a vote reveal happens, in ms from its start. The ballots turn over
 * together, then one stone after another leaves its card for its pan, seat by seat from
 * the leader; the verdict waits until the last stone is down.
 */
export function voteRevealTimeline(count: number, reduceMotion = false) {
  if (reduceMotion) return { stones: Array.from({ length: count }, () => 0), flight: 0, verdict: 0, done: 1600 };
  const flight = 420;
  const stones = Array.from({ length: count }, (_, i) => 760 + i * 75);
  const verdict = (stones.at(-1) ?? 760) + flight + 110;
  return { stones, flight, verdict, done: verdict + 1150 };
}

/** The index of the card whose turn settles the quest, judged only from cards already face up. */
export function missionDecidedAt(cards: MissionCard[], requiredFails: number) {
  let fails = 0;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i] === 'fail') fails++;
    if (fails >= requiredFails || fails + (cards.length - 1 - i) < requiredFails) return i;
  }
  return cards.length - 1;
}

/**
 * When each beat of a mission reveal happens, in ms from its start. Cards turn one
 * at a time, each wait a little longer than the last, the deciding one longest. Once
 * the table can see the outcome, the rest turn over in a quick run. The verdict
 * follows, then its seal flies to the quest board. `complete` is a backstop for the
 * flight, which normally ends the reveal when it lands.
 */
export function missionRevealTimeline(cards: MissionCard[], requiredFails: number, reduceMotion = false) {
  if (reduceMotion)
    return { shuffle: 0, reveal: 0, flips: [] as number[], verdict: 0, seal: 0, complete: 1800 };
  const reveal = 1850;
  const decided = missionDecidedAt(cards, requiredFails);
  const flips: number[] = [];
  for (let i = 0, at = reveal + 450; i < cards.length; i++) {
    if (i > decided) at += 140;
    else if (i > 0) at += 480 + 140 * (i - 1) + (i === decided ? 520 : 0);
    flips.push(at);
  }
  const verdict = (flips.at(-1) ?? reveal) + (decided === cards.length - 1 ? 800 : 550);
  const seal = verdict + 1150;
  return { shuffle: 650, reveal, flips, verdict, seal, complete: seal + 1600 };
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
