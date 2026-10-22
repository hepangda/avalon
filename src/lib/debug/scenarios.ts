import {
  createGame,
  createRng,
  reduce,
  recommendedOptions,
  missionSize,
  requiredFails,
  teamOf,
  type GameState,
  type GameEvent,
  type VoteValue,
} from "@/lib/engine";

export const SCENARIOS = [
  { id: "role", group: "identity" },
  { id: "team", group: "proposal" },
  { id: "announcement", group: "proposal" },
  { id: "discussion", group: "proposal" },
  { id: "finalizing", group: "proposal" },
  { id: "overdue", group: "proposal" },
  { id: "lastProposal", group: "proposal" },
  { id: "voting", group: "proposal" },
  { id: "voted", group: "proposal" },
  { id: "approved", group: "proposal" },
  { id: "rejected", group: "proposal" },
  { id: "missionGood", group: "mission" },
  { id: "missionEvil", group: "mission" },
  { id: "submitted", group: "mission" },
  { id: "missionSuccess", group: "mission" },
  { id: "missionFail", group: "mission" },
  { id: "twoFails", group: "mission", minPlayers: 7 },
  { id: "lady", group: "special" },
  { id: "ladyGood", group: "special" },
  { id: "ladyEvil", group: "special" },
  { id: "voteSheet", group: "special" },
  { id: "assassination", group: "special" },
  { id: "earlyAssassinationProposal", group: "special" },
  { id: "earlyAssassination", group: "special" },
  { id: "assassinHit", group: "ending" },
  { id: "assassinMiss", group: "ending" },
  { id: "goodWins", group: "ending" },
  { id: "evilWins", group: "ending" },
  { id: "threeFails", group: "ending" },
  { id: "fiveRejections", group: "ending" },
  { id: "spectator", group: "connection" },
  { id: "openSeat", group: "connection" },
  { id: "offline", group: "connection" },
  { id: "reconnecting", group: "connection" },
] as const;
export type ScenarioId = (typeof SCENARIOS)[number]["id"];
export interface Scenario {
  state: GameState;
  viewerId: string;
  /** Apply after mounting so the real presentation queue sees the transition. */
  nextState?: GameState;
  openSeatId?: string;
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const result = reduce(state, event, {
    now: 1_800_000_000_000 + state.logSeq * 1000,
    rng: createRng(state.seed),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

export function propose(state: GameState, discuss = true): GameState {
  // Include evil seats so both valid mission card choices can be exercised.
  const good = state.players.find((p) => teamOf(p.role) === "good")!;
  const team = [
    good,
    ...[...state.players]
      .filter((p) => p.id !== good.id)
      .sort(
        (a, b) =>
          Number(teamOf(b.role) === "evil") - Number(teamOf(a.role) === "evil"),
      ),
  ]
    .slice(0, missionSize(state.players.length, state.roundIndex))
    .map((p) => p.id);
  let next = applyEvent(state, {
    type: "PROPOSE_TEAM",
    by: state.players[state.leaderIndex]!.id,
    team,
  });
  if (!discuss) return next;
  if (next.phase === 'TeamAnnouncement') next = applyEvent(next, { type: 'START_DISCUSSION', by: state.players[state.leaderIndex]!.id });
  for (const by of next.discussion!.order) next = applyEvent(next, { type: 'END_SPEECH', by });
  return applyEvent(next, { type: 'FINALIZE_TEAM', by: state.players[state.leaderIndex]!.id, team });
}

export function completeVotes(state: GameState, value: VoteValue): GameState {
  let next = state;
  for (const p of state.players) {
    if (next.phase === "Voting" && next.votes[p.id] === undefined)
      next = applyEvent(next, { type: "CAST_VOTE", by: p.id, value });
  }
  return next;
}

/** Keep existing consent and stop as soon as the proposal passes or is rejected. */
export function completeAssassinationVotes(
  state: GameState,
  value: VoteValue,
): GameState {
  let next = state;
  for (const by of state.earlyAssassination?.voterIds ?? []) {
    const ballot = next.earlyAssassination;
    if (!ballot) break;
    if (ballot.votes[by] !== undefined) continue;
    next = applyEvent(next, {
      type: "VOTE_ASSASSINATION",
      by,
      proposalId: ballot.id,
      value,
    });
  }
  return next;
}

/** Existing cards stay submitted; only evil players can contribute a fail. */
export function completeMission(
  state: GameState,
  desiredFails: number,
): GameState {
  let next = state;
  let remaining = Math.max(
    0,
    desiredFails -
      Object.values(state.missionCards).filter((c) => c === "fail").length,
  );
  for (const id of state.proposedTeam ?? []) {
    if (next.phase !== "MissionVote" || next.missionCards[id] !== undefined)
      continue;
    const fail =
      remaining > 0 &&
      teamOf(state.players.find((p) => p.id === id)!.role) === "evil";
    if (fail) remaining--;
    next = applyEvent(next, {
      type: "CAST_MISSION_CARD",
      by: id,
      card: fail ? "fail" : "success",
    });
  }
  return next;
}

function inspect(
  state: GameState,
  loyalty: "good" | "evil" = "good",
): GameState {
  const target = state.players.find(
    (p) =>
      p.id !== state.ladyHolderId &&
      !state.ladyInspectedIds.includes(p.id) &&
      teamOf(p.role) === loyalty,
  )!;
  return applyEvent(state, {
    type: "USE_LADY",
    by: state.ladyHolderId!,
    target: target.id,
  });
}

/** Each seat votes its own way: `approves(seat)` decides. */
function splitVotes(state: GameState, approves: (seat: number) => boolean): GameState {
  let next = state;
  for (const p of state.players)
    next = applyEvent(next, { type: "CAST_VOTE", by: p.id, value: approves(p.seat) ? "approve" : "reject" });
  return next;
}

function playRound(state: GameState, fails: number): GameState {
  const ready = state.phase === "LadyOfLake" ? inspect(state) : state;
  return completeMission(completeVotes(propose(ready), "approve"), fails);
}

export function buildScenario(id: ScenarioId, playerCount: number): Scenario {
  const created = createGame({
    hostId: "p0",
    seed: `debug-gallery-${playerCount}`,
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i}`,
      name: [
        "Arthur",
        "Luna",
        "林间晚风",
        "Gawain",
        "Mira",
        "星河",
        "Rowan",
        "长名字的圆桌骑士",
        "Iris",
        "Finn",
      ][i]!,
    })),
    options: { ...recommendedOptions(playerCount), ladyOfTheLake: true },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = applyEvent(created.state, { type: "START_GAME", by: "p0" });
  const leader = () => state.players[state.leaderIndex]!.id;
  if (id === "role") return { state, viewerId: leader() };
  for (const p of state.players)
    state = applyEvent(state, { type: "ACK_ROLE", by: p.id });

  if (id === "earlyAssassinationProposal")
    return { state, viewerId: state.assassinId! };

  if (['announcement', 'discussion', 'finalizing', 'overdue'].includes(id)) {
    state = propose(state, false);
    if (id === 'announcement') return { state, viewerId: leader() };
    state = applyEvent(state, { type: 'START_DISCUSSION', by: leader() });
    if (id === 'finalizing') {
      for (const by of state.discussion!.order) state = applyEvent(state, { type: 'END_SPEECH', by });
    } else if (id === 'overdue') {
      state.actionTimers = state.actionTimers?.map((timer) => ({ ...timer, startedAt: timer.startedAt - timer.durationMs - 10_000 }));
    }
    return { state, viewerId: id === 'finalizing' ? leader() : state.discussion!.order[0]! };
  }

  if (id === "lastProposal" || id === "fiveRejections") {
    for (let i = 0; i < 4; i++)
      state = completeVotes(propose(state), "reject");
    if (id === "lastProposal") return { state, viewerId: leader() };
    // The ending plays from the fifth rejection itself.
    state = propose(state);
    return { state, viewerId: leader(), nextState: completeVotes(state, "reject") };
  }
  if (id === "offline") {
    state = applyEvent(state, {
      type: "SET_CONNECTED",
      by: state.players[(state.leaderIndex + 1) % playerCount]!.id,
      connected: false,
    });
  }
  if (["team", "offline", "reconnecting", "spectator", "openSeat"].includes(id))
    return {
      state,
      viewerId: ["spectator", "openSeat"].includes(id) ? "spectator" : leader(),
      ...(id === "openSeat" ? { openSeatId: "p0" } : {}),
    };

  if (id === "voteSheet") {
    // Split tables, turned-down teams and a sabotage, then a discussion under way.
    state = splitVotes(propose(state), (seat) => seat % 3 === 0);
    state = completeMission(splitVotes(propose(state), (seat) => seat % 4 !== 1), 0);
    state = splitVotes(propose(state), (seat) => seat % 2 === 1);
    state = completeMission(splitVotes(propose(state), (seat) => seat % 5 !== 2), 1);
    if (state.phase === "LadyOfLake") state = inspect(state, "evil");
    state = splitVotes(propose(state), (seat) => seat < 2);
    state = splitVotes(propose(state), (seat) => seat < Math.floor(playerCount / 2));
    state = completeMission(splitVotes(propose(state), (seat) => seat !== 3), 0);
    if (state.phase === "LadyOfLake") state = inspect(state, "good");
    state = propose(state, false);
    state = applyEvent(state, { type: "START_DISCUSSION", by: leader() });
    for (const by of state.discussion!.order.slice(0, 3)) state = applyEvent(state, { type: "END_SPEECH", by });
    return { state, viewerId: state.players.find((p) => p.id !== leader())!.id };
  }
  if (["lady", "ladyGood", "ladyEvil"].includes(id)) {
    state = playRound(playRound(state, 0), 1);
    const viewerId = state.ladyHolderId!;
    if (id === "lady") return { state, viewerId };
    // The result plays from the inspection itself.
    return { state, viewerId, nextState: inspect(state, id === "ladyGood" ? "good" : "evil") };
  }
  if (
    [
      "assassination",
      "goodWins",
      "evilWins",
      "threeFails",
      "earlyAssassination",
      "assassinHit",
      "assassinMiss",
    ].includes(id)
  ) {
    if (id === "earlyAssassination")
      state = applyEvent(state, {
        type: "START_ASSASSINATION",
        by: state.assassinId!,
      });
    else if (id === "threeFails") {
      // The ending plays from the third failed mission itself.
      for (let i = 0; i < 2; i++) state = playRound(state, 1);
      const ready = state.phase === "LadyOfLake" ? inspect(state) : state;
      state = completeVotes(propose(ready), "approve");
      return { state, viewerId: state.assassinId!, nextState: completeMission(state, 1) };
    } else
      for (let i = 0; i < 3; i++) state = playRound(state, 0);
    if (id === "goodWins" || id === "evilWins" || id === "assassinHit" || id === "assassinMiss") {
      const target = state.players.find((p) =>
        id === "evilWins" || id === "assassinHit"
          ? p.role === "Merlin"
          : teamOf(p.role) === "good" && p.role !== "Merlin",
      )!;
      const nextState = applyEvent(state, {
        type: "ASSASSINATE",
        by: state.assassinId!,
        target: target.id,
      });
      if (id === "assassinHit" || id === "assassinMiss") {
        return { state, viewerId: state.assassinId!, nextState };
      }
      state = nextState;
    }
    return { state, viewerId: state.assassinId! };
  }
  if (id === "twoFails") {
    if (playerCount < 7)
      throw new Error(
        "The fourth mission requires two fails with 7–10 players.",
      );
    for (const fails of [0, 1, 0]) state = playRound(state, fails);
    state = inspect(state);
  }
  state = propose(state);
  if (["voting", "voted", "approved", "rejected"].includes(id)) {
    const viewerId = leader();
    if (id === "voting" || id === "voted") {
      const voters =
        id === "voted"
          ? [viewerId]
          : state.players
              .filter((p) => p.id !== viewerId)
              .slice(0, 2)
              .map((p) => p.id);
      for (const by of voters)
        state = applyEvent(state, { type: "CAST_VOTE", by, value: "approve" });
      return { state, viewerId };
    }
    return {
      state,
      viewerId,
      nextState: completeVotes(state, id === "approved" ? "approve" : "reject"),
    };
  }
  state = completeVotes(state, "approve");
  const viewerId = state.proposedTeam!.find(
    (pid) =>
      teamOf(state.players.find((p) => p.id === pid)!.role) ===
      (id === "missionGood" ? "good" : "evil"),
  )!;
  if (id === "submitted")
    state = applyEvent(state, {
      type: "CAST_MISSION_CARD",
      by: viewerId,
      card: "success",
    });
  if (id === "missionSuccess" || id === "missionFail")
    return {
      state,
      viewerId,
      nextState: completeMission(
        state,
        id === "missionFail" ? requiredFails(playerCount, state.roundIndex) : 0,
      ),
    };
  return { state, viewerId };
}
