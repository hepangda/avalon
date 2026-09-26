import { describe, expect, it } from "vitest";
import {
  projectStateForViewer,
  requiredFails,
  teamOf,
  validateRoleSet,
} from "@/lib/engine";
import {
  applyEvent,
  buildScenario,
  completeMission,
  completeVotes,
  SCENARIOS,
} from "./scenarios";
import { newTablePresentations } from "@/lib/game/tablePresentation";

const expectedPhases: Record<string, string> = {
  role: "TeamBuilding",
  team: "TeamBuilding",
  announcement: "Discussion",
  discussion: "Discussion",
  finalizing: "TeamFinalizing",
  overdue: "Discussion",
  lastProposal: "TeamBuilding",
  voting: "Voting",
  voted: "Voting",
  approved: "Voting",
  rejected: "Voting",
  missionGood: "MissionVote",
  missionEvil: "MissionVote",
  submitted: "MissionVote",
  missionSuccess: "MissionVote",
  missionFail: "MissionVote",
  twoFails: "MissionVote",
  lady: "LadyOfLake",
  ladyGood: "TeamBuilding",
  ladyEvil: "TeamBuilding",
  assassination: "Assassination",
  earlyAssassination: "Assassination",
  assassinHit: "Assassination",
  assassinMiss: "Assassination",
  goodWins: "GameOver",
  evilWins: "GameOver",
  threeFails: "GameOver",
  fiveRejections: "GameOver",
  spectator: "TeamBuilding",
  openSeat: "TeamBuilding",
  offline: "TeamBuilding",
  reconnecting: "TeamBuilding",
};

describe.each([5, 6, 7, 8, 9, 10])("gallery with %i players", (count) => {
  for (const scene of SCENARIOS) {
    if ("minPlayers" in scene && count < scene.minPlayers) continue;
    it(`builds a valid, deterministic ${scene.id} scene`, () => {
      const scenario = buildScenario(scene.id, count);
      const { state, viewerId } = scenario;
      expect(scenario).toEqual(buildScenario(scene.id, count));
      expect(state.phase).toBe(expectedPhases[scene.id]);
      expect(state.players).toHaveLength(count);
      expect(
        validateRoleSet(
          count,
          state.players.map((p) => p.role),
        ),
      ).toBe(true);
      expect(
        viewerId === "spectator" ||
          state.players.some((p) => p.id === viewerId),
      ).toBe(true);
      const view = projectStateForViewer(state, viewerId);
      expect(view.isSpectator).toBe(viewerId === "spectator");
      for (const result of state.missionResults) {
        expect(result.team).toHaveLength(result.teamSize);
        expect(result.success).toBe(
          result.failCount < requiredFails(count, result.roundIndex),
        );
        for (const [id, card] of Object.entries(result.cards)) {
          if (card === "fail")
            expect(teamOf(state.players.find((p) => p.id === id)!.role)).toBe(
              "evil",
            );
        }
      }
    });
  }

  it("projects private roles and Lady results for the right viewer only", () => {
    const { state, viewerId } = buildScenario("ladyEvil", count);
    expect(
      projectStateForViewer(state, viewerId).privateLadyResult?.loyalty,
    ).toBe("evil");
    expect(
      projectStateForViewer(state, "spectator").privateLadyResult,
    ).toBeUndefined();
    expect(
      projectStateForViewer(state, "spectator").players.every((p) => !p.role),
    ).toBe(true);
  });

  it("provides the correct mission perspective and rejects a good fail card", () => {
    const good = buildScenario("missionGood", count);
    expect(
      projectStateForViewer(good.state, good.viewerId).selfRole,
    ).not.toBeNull();
    expect(
      teamOf(good.state.players.find((p) => p.id === good.viewerId)!.role),
    ).toBe("good");
    expect(() =>
      applyEvent(good.state, {
        type: "CAST_MISSION_CARD",
        by: good.viewerId,
        card: "fail",
      }),
    ).toThrow();
    const evil = buildScenario("missionEvil", count);
    expect(
      teamOf(evil.state.players.find((p) => p.id === evil.viewerId)!.role),
    ).toBe("evil");
  });

  it("produces real result presentations on the transition", () => {
    for (const id of [
      "approved",
      "rejected",
      "missionSuccess",
      "missionFail",
    ] as const) {
      const scene = buildScenario(id, count);
      const events = newTablePresentations(
        projectStateForViewer(scene.state, scene.viewerId),
        projectStateForViewer(scene.nextState!, scene.viewerId),
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.kind).toBe(
        id.startsWith("mission") ? "mission" : "vote",
      );
    }
  });

  it("keeps submitted votes and cards when completing other players", () => {
    const vote = buildScenario("voted", count);
    const afterVote = completeVotes(vote.state, "reject");
    expect(afterVote.voteHistory.at(-1)!.votes[vote.viewerId]).toBe("approve");
    const mission = buildScenario("submitted", count);
    const afterMission = completeMission(mission.state, 4);
    expect(afterMission.missionResults.at(-1)!.cards[mission.viewerId]).toBe(
      "success",
    );
  });

  it("previews confirmed assassination hits and misses", () => {
    for (const id of ["assassinHit", "assassinMiss"] as const) {
      const scene = buildScenario(id, count);
      const events = newTablePresentations(
        projectStateForViewer(scene.state, scene.viewerId),
        projectStateForViewer(scene.nextState!, scene.viewerId),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "assassination", hitMerlin: id === "assassinHit" });
    }
  });
});

it("reproduces both sides of the two-fail threshold", () => {
  const { state } = buildScenario("twoFails", 7);
  expect(state.roundIndex).toBe(3);
  expect(completeMission(state, 1).missionResults.at(-1)!.success).toBe(true);
  expect(completeMission(state, 2).missionResults.at(-1)!.success).toBe(false);
});

it.each([
  ["goodWins", "good", "assassin_missed"],
  ["evilWins", "evil", "assassinated_merlin"],
  ["threeFails", "evil", "three_missions"],
  ["fiveRejections", "evil", "five_rejections"],
] as const)("reaches the correct %s outcome", (id, winner, reason) => {
  expect(buildScenario(id, 7).state.outcome).toMatchObject({ winner, reason });
});
