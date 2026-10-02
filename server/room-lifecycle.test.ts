import { afterEach, describe, expect, it, vi } from "vitest";
import { roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe("room lifecycle and referee handlers (snapshot + WebSocket harness)", () => {
  it("requires referee authorization to pause and resume timers and preserves pauses after runtime recreation", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    expect(
      (await h.action(h.host, "admin:setTimersPaused", { paused: true })).error
        ?.code,
    ).toBe("NOT_ADMIN");
    expect(
      (await h.action(h.spectator, "admin:setTimersPaused", { paused: false }))
        .error?.code,
    ).toBe("NOT_ADMIN");
    await h.action(h.host, "admin:auth");
    expect(
      (await h.action(h.host, "admin:setTimersPaused", { paused: "yes" })).error
        ?.code,
    ).toBe("INVALID");
    expect(
      (await h.action(h.host, "admin:setTimersPaused", { paused: true })).ok,
    ).toBe(true);
    const timers = structuredClone(h.host.game.actionTimers);
    expect(timers?.length).toBeGreaterThan(0);
    expect(timers?.every((timer) => typeof timer.pausedAt === "number")).toBe(
      true,
    );
    expect(h.spectator.game.actionTimers).toEqual(timers);
    expect(h.host.game.logs.at(-1)?.key).toBe("admin.timersPaused");
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game.actionTimers).toEqual(timers);
    expect(
      (await h.action(h.host, "admin:setTimersPaused", { paused: true })).ok,
    ).toBe(true);
    expect(h.host.game.actionTimers).toEqual(timers);
    expect(
      (await h.action(h.host, "admin:setTimersPaused", { paused: false })).ok,
    ).toBe(true);
    expect(
      h.host.game.actionTimers?.every((timer) => timer.pausedAt === undefined),
    ).toBe(true);
    expect(h.host.game.logs.at(-1)?.key).toBe("admin.timersResumed");
    const resumed = structuredClone(h.host.game.actionTimers);
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game.actionTimers).toEqual(resumed);
  });

  it("restricts speech skipping to referees and persists skips without affecting the next speaker twice", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    await h.action(h.host, "admin:auth");
    await h.action(h.host, "admin:propose", { team: ["p0", "p2"] });
    const leader = h.sockets.find((socket) => socket.game.players.some(
      (p) => p.isLeader && p.id === socket.deserializeAttachment().playerId,
    ))!;
    await h.action(leader, "game:ackRole");
    await h.action(leader, "game:startDiscussion");
    const order = h.host.game.discussion!.order;
    const targetPlayerId = order[0]!;
    expect(
      (await h.action(h.spectator, "admin:skipSpeech", { targetPlayerId }))
        .error?.code,
    ).toBe("NOT_ADMIN");
    expect(
      (await h.action(h.host, "admin:skipSpeech", { targetPlayerId: order[1] }))
        .error?.code,
    ).toBe("NOT_SPEAKER");
    expect((await h.action(h.host, "admin:skipSpeech", {})).error?.code).toBe(
      "INVALID",
    );
    expect(
      (await h.action(h.host, "admin:skipSpeech", { targetPlayerId })).ok,
    ).toBe(true);
    expect(h.host.game.discussion?.speakerIndex).toBe(1);
    expect(h.spectator.game.logs).toContainEqual(
      expect.objectContaining({
        key: "admin.speechSkipped",
        style: "admin",
        params: expect.objectContaining({ player: targetPlayerId }),
      }),
    );
    expect(
      (await h.action(h.host, "admin:skipSpeech", { targetPlayerId })).error
        ?.code,
    ).toBe("NOT_SPEAKER");
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game.discussion?.speakerIndex).toBe(1);
    for (const id of order.slice(1))
      expect(
        (await h.action(h.host, "admin:skipSpeech", { targetPlayerId: id })).ok,
      ).toBe(true);
    expect(h.host.game.phase).toBe("TeamFinalizing");
    expect(
      (await h.action(h.host, "admin:skipSpeech", { targetPlayerId })).error
        ?.code,
    ).toBe("WRONG_PHASE");
  });

  it("enforces speaking turns and recovers their timers after runtime recreation", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    const players = h.sockets.filter((socket) => socket !== h.spectator);
    for (const socket of players) await h.action(socket, "game:ackRole");
    const leader = players.find((socket) =>
      socket.game.players.some(
        (p) => p.id === socket.deserializeAttachment().playerId && p.isLeader,
      ),
    )!;
    const byId = (id: string) =>
      players.find((socket) => socket.deserializeAttachment().playerId === id)!;
    const other = players.find((socket) => socket !== leader)!;
    const team = ["p0", "p2"];
    expect((await h.action(leader, "game:proposeTeam", { team })).ok).toBe(
      true,
    );
    expect(h.spectator.game.phase).toBe("TeamAnnouncement");
    expect(leader.game.actionTimers?.[0]?.durationMs).toBe(60_000);
    expect((await h.action(other, "game:startDiscussion")).error?.code).toBe("NOT_LEADER");
    expect((await h.action(leader, "game:startDiscussion", { direction: "counterclockwise" })).ok).toBe(true);
    expect(h.spectator.game.phase).toBe("Discussion");
    expect(h.spectator.game.proposedTeam).toEqual(team);
    expect((await h.action(other, "game:startDiscussion")).error?.code).toBe(
      "WRONG_PHASE",
    );
    expect(
      (await h.action(other, "game:vote", { value: "approve" })).error?.code,
    ).toBe("WRONG_PHASE");
    expect(
      (await h.action(leader, "game:finalizeTeam", { team })).error?.code,
    ).toBe("WRONG_PHASE");
    expect(leader.game.discussion?.order.at(-1)).toBe(
      leader.deserializeAttachment().playerId,
    );
    expect((await h.action(leader, "game:endSpeech")).error?.code).toBe(
      "NOT_SPEAKER",
    );
    const timers = structuredClone(leader.game.actionTimers);
    expect(timers?.[0]?.durationMs).toBe(120_000);
    expect(timers?.[0]?.playerId).toBe(leader.game.discussion?.order[0]);
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game.actionTimers).toEqual(timers);
    expect(h.spectator.game.serverTime).toEqual(expect.any(Number));
    for (const id of leader.game.discussion!.order)
      expect((await h.action(byId(id), "game:endSpeech")).ok).toBe(true);
    expect(leader.game.phase).toBe("TeamFinalizing");
    expect(
      (await h.action(other, "game:finalizeTeam", { team })).error?.code,
    ).toBe("NOT_LEADER");
    expect(
      (await h.action(leader, "game:finalizeTeam", { team: ["p3", "p4"] })).ok,
    ).toBe(true);
    expect(leader.game.phase).toBe("Voting");
    expect(leader.game.actionTimers).toHaveLength(5);
    expect(
      leader.game.actionTimers?.every((timer) => timer.durationMs === 20_000),
    ).toBe(true);
    const pending = structuredClone(leader.game.actionTimers);
    await h.action(leader, "game:vote", { value: "approve" });
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game.actionTimers).toEqual(
      pending?.filter(
        (timer) => timer.playerId !== leader.deserializeAttachment().playerId,
      ),
    );
  });

  it("broadcasts only a small latency delta during a game and includes it in later snapshots", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    expect((await h.action(h.host, "room:start")).ok).toBe(true);
    for (const socket of h.sockets) socket.messages = [];

    expect((await h.action(h.host, "net:ping", { rtt: 230.4 })).ok).toBe(true);
    for (const socket of h.sockets) {
      expect(socket.messages.filter((m) => m.t === "push")).toEqual([
        {
          t: "push",
          event: "net:latency",
          payload: { playerId: "p0", latency: 230 },
        },
      ]);
      socket.messages = [];
    }
    await h.action(h.host, "net:ping", { rtt: 230 });
    await h.action(h.spectator, "net:ping", { rtt: 999 });
    expect(
      h.sockets.flatMap((s) => s.messages).filter((m) => m.t === "push"),
    ).toEqual([]);

    await h.action(h.spectator, "room:join");
    expect(
      h.spectator.snapshot.members.find((m) => m.id === "p0")?.latency,
    ).toBe(230);
    expect(h.spectator.game.players.find((p) => p.id === "p0")?.latency).toBe(
      230,
    );
  });

  it("authorizes and persists opening rerolls, refreshes private roles, and replays them after wake", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    const gameId = h.host.game.gameId!;
    for (const event of ["admin:rerollLeader", "admin:rerollRoles"]) {
      expect((await h.action(h.host, event)).error?.code).toBe("NOT_ADMIN");
    }
    await h.action(h.host, "game:ackRole");
    await h.action(h.host, "admin:auth");
    expect((await h.action(h.host, "admin:rerollLeader")).ok).toBe(true);
    const leader = h.host.game.leaderIndex;
    expect(h.host.game.roleAcks).toEqual(["p0"]);
    expect((await h.action(h.host, "admin:rerollRoles")).ok).toBe(true);
    expect(h.host.game).toMatchObject({
      gameId,
      leaderIndex: leader,
      roleAcks: [],
      roleRevision: 1,
      canRerollOpening: true,
    });
    expect(
      (await h.action(h.host, "game:ackRole", { roleRevision: 0 })).error?.code,
    ).toBe("WRONG_PHASE");
    expect(
      (await h.action(h.host, "game:ackRole", { roleRevision: 1 })).ok,
    ).toBe(true);
    const roles = h.sockets
      .filter((s) => s !== h.spectator)
      .map((s) => ({
        playerId: s.deserializeAttachment().playerId!,
        role: s.game.selfRole,
      }));
    for (const socket of h.sockets.filter((s) => s !== h.spectator)) {
      const reveal = socket.messages
        .filter((m) => m.event === "private:reveal")
        .at(-1)?.payload;
      expect(reveal).toEqual({
        selfRole: socket.game.selfRole,
        knownPlayers: socket.game.knownPlayers,
      });
      expect(socket.game.logs.filter((l) => l.key === "yourRole")).toHaveLength(
        1,
      );
    }
    expect(h.spectator.game.players.every((p) => p.role === undefined)).toBe(
      true,
    );
    expect(h.spectator.game.logs.every((l) => l.channel === "public")).toBe(
      true,
    );
    expect(
      h.spectator.messages.filter((m) => m.event === "private:reveal"),
    ).toEqual([]);
    const publicView = h.spectator.game;
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game).toMatchObject({
      leaderIndex: leader,
      roleRevision: 1,
      roleAcks: ["p0"],
      canRerollOpening: true,
    });
    for (const key of ["admin.leaderRerolled", "admin.rolesRerolled"]) {
      // Existing panel-open notices are transient and can offset log sequence numbers.
      const { seq: _seq, ...entry } = publicView.logs.find(
        (l) => l.key === key,
      )!;
      expect(h.spectator.game.logs.find((l) => l.key === key)).toMatchObject(
        entry,
      );
    }
    await h.finish();
    const archived = h.archives.get(gameId)!;
    expect(
      archived.roleAssignments.map(({ playerId, role }) => ({
        playerId,
        role,
      })),
    ).toEqual(expect.arrayContaining(roles));
    expect(archived.roleAssignments).toHaveLength(roles.length);
    expect(archived.outcome?.winner).toBe("evil");
  });

  it.each(["admin:retractProposal", "admin:previousPhase"])(
    "does not reopen opening rerolls after %s or a server wake",
    async (returnEvent) => {
      const h = roomHarness();
      await h.action(h.host, "room:removeSeat", { seatId: "p1" });
      await h.action(h.host, "room:start");
      await h.action(h.host, "admin:auth");
      expect(
        (await h.action(h.host, "admin:propose", { team: ["p0", "p2"] })).ok,
      ).toBe(true);
      expect((await h.action(h.host, returnEvent)).ok).toBe(true);
      expect(h.host.game).toMatchObject({
        phase: "TeamBuilding",
        roundIndex: 0,
        canRerollOpening: false,
      });
      h.wake();
      await h.action(h.spectator, "room:join");
      expect(h.spectator.game.canRerollOpening).toBe(false);
      const before = h.document.eventSeq;
      for (const event of ["admin:rerollLeader", "admin:rerollRoles"]) {
        expect((await h.action(h.host, event)).error?.code).toBe("WRONG_PHASE");
      }
      expect(h.document.eventSeq).toBe(before);
    },
  );

  it("creates a room without external media credentials or network requests", async () => {
    const h = roomHarness(false);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network request"));
    const created = await h.room.init({
      code: "1234",
      roster: ["Seat 1", "Seat 2"],
      creator: { name: "Room owner" },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    expect(created.playerToken).toBeTruthy();
    expect(
      h.document.members.find((m) => m.id === created.playerId),
    ).toMatchObject({ name: "Room owner", claimed: true });
    expect(await h.room.preview()).toMatchObject({
      code: "1234",
      playerCount: 1,
    });
    expect(await h.room.preview()).not.toHaveProperty("voiceEnabled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["voice:token", "voice:presence", "voice:dropped"])(
    "rejects the retired %s endpoint",
    async (event) => {
      const h = roomHarness();
      const response = await h.action(h.host, event, {
        status: "joined",
        playerId: "p0",
      });
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe("UNKNOWN_EVENT");
    },
  );

  it("deals only to seated players, preserving disconnected participants and compacting seat order", async () => {
    const h = roomHarness();
    h.sockets.splice(1, 1); // p2 still holds a seat, but has no live connection.
    h.wake();

    expect((await h.action(h.host, "room:start")).ok).toBe(true);

    for (const socket of h.sockets) {
      expect(
        socket.game.players.map((p) => [p.id, p.claimed, p.connected]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ["p0", true, true],
        ["p2", true, false],
        ["p3", true, true],
        ["p4", true, true],
        ["p5", true, true],
      ]);
      expect(socket.game.players.map((player) => player.seat)).toEqual([0, 1, 2, 3, 4]);
    }
    expect(h.document.members.some((member) => member.id === 'p1')).toBe(false);
    expect(h.document.sessions.p2).toBe('token-2');
  });

  it("updates presence for every viewer when a player takes and releases an empty seat", async () => {
    const h = roomHarness();
    await h.action(h.spectator, "room:claimSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    await h.action(h.spectator, "room:releaseSeat");

    expect(
      (await h.action(h.spectator, "room:claimSeat", { seatId: "p1" })).ok,
    ).toBe(true);
    for (const socket of h.sockets) {
      expect(socket.game.players.find((p) => p.id === "p1")).toMatchObject({
        claimed: true,
        connected: true,
      });
    }

    expect((await h.action(h.spectator, "room:releaseSeat")).ok).toBe(true);
    for (const socket of h.sockets) {
      expect(socket.game.players.find((p) => p.id === "p1")).toMatchObject({
        claimed: false,
        connected: false,
      });
    }
  });

  it.each(["room:releaseSeat", "room:leave", "room:claimSeat", "admin:unbind"])(
    "restores the seat identity for all viewers and after wake on %s",
    async (event) => {
      const h = roomHarness();
      await h.action(h.spectator, "room:claimSeat", { seatId: "p1" });
      expect((await h.action(h.host, "room:start")).ok).toBe(true);
      await h.action(h.spectator, "room:releaseSeat");
      const player = h.sockets[1]!;
      if (event === "admin:unbind") {
        expect((await h.action(h.host, "admin:auth")).ok).toBe(true);
      }
      const response =
        event === "admin:unbind"
          ? await h.action(h.host, event, { targetPlayerId: "p2" })
          : await h.action(
            player,
            event,
            event === "room:claimSeat"
              ? { seatId: "p1", name: "New name" }
              : {},
          );
      expect(response.ok).toBe(true);
      for (const socket of h.sockets) {
        const seat = socket.game.players.find((p) => p.id === "p2");
        expect(seat).toMatchObject({
          name: "Seat 2",
          claimed: false,
          connected: false,
        });
        expect(seat?.avatarUrl).toBeUndefined();
        expect(socket.snapshot.members.find((p) => p.id === "p2")?.name).toBe(
          "Seat 2",
        );
        if (event === "room:claimSeat") {
          expect(socket.game.players.find((p) => p.id === "p1")).toMatchObject({
            name: "New name",
            claimed: true,
            connected: true,
          });
        }
      }
      expect(h.document.members.find((m) => m.id === "p2")).toMatchObject({
        name: "Seat 2",
        claimed: false,
      });
      h.wake();
      expect((await h.action(h.spectator, "room:join")).ok).toBe(true);
      expect(h.spectator.game.players.find((p) => p.id === "p2")).toMatchObject(
        { name: "Seat 2", claimed: false, connected: false },
      );
    },
  );

  it("keeps the occupant identity when a seated player disconnects mid-game", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:start");
    const player = h.sockets.splice(1, 1)[0]!;
    await h.room.webSocketClose(player.ws);
    expect(h.host.game.players.find((p) => p.id === "p2")).toMatchObject({
      name: "Player 2",
      avatarUrl: "https://example.com/2.png",
      claimed: true,
      connected: false,
    });
  });

  it("uses live room presence after runtime recreation instead of replayed connection events", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:start");
    const player = h.sockets[1]!;
    await h.action(player, "room:join", {
      playerId: "p2",
      playerToken: "token-2",
    });
    h.sockets.splice(1, 1); // The socket is gone, but its last recorded event was online.
    h.wake();

    expect((await h.action(h.spectator, "room:join")).ok).toBe(true);
    expect(h.spectator.game.players.find((p) => p.id === "p1")).toBeUndefined();
    expect(h.spectator.game.players.find((p) => p.id === "p2")).toMatchObject({
      claimed: true,
      connected: false,
    });
    expect(h.spectator.game.players.find((p) => p.id === "p0")?.connected).toBe(
      true,
    );

    h.sockets.push(player);
    expect(
      (
        await h.action(player, "room:join", {
          playerId: "p2",
          playerToken: "token-2",
        })
      ).ok,
    ).toBe(true);
    for (const socket of h.sockets) {
      expect(socket.game.players.find((p) => p.id === "p2")).toMatchObject({
        claimed: true,
        connected: true,
      });
    }
  });

  it("deletes a middle empty seat without replacing later occupied identities or sessions", async () => {
    const h = roomHarness();
    expect(
      (await h.action(h.spectator, "room:removeSeat", { seatId: "p1" })).error
        ?.code,
    ).toBe("NOT_HOST");
    expect(
      (await h.action(h.host, "room:removeSeat", { seatId: "p2" })).error?.code,
    ).toBe("SEAT_CLAIMED");
    expect(
      (await h.action(h.host, "room:removeSeat", { seatId: "p1" })).ok,
    ).toBe(true);
    expect(h.host.snapshot.members.map((m) => [m.id, m.seat, m.name])).toEqual(
      [0, 2, 3, 4, 5].map((n, i) => [`p${n}`, i, `Player ${n}`]),
    );
    expect(h.host.snapshot.members[1]?.avatarUrl).toBe(
      "https://example.com/2.png",
    );
    expect(h.host.snapshot.config.roster).toEqual([
      "Seat 0",
      "Seat 2",
      "Seat 3",
      "Seat 4",
      "Seat 5",
    ]);
    expect(h.document.sessions.p2).toBe("token-2");
    h.wake();
    expect(
      (
        await h.action(h.sockets[1]!, "room:join", {
          playerId: "p2",
          playerToken: "token-2",
        })
      ).ok,
    ).toBe(true);
    expect(
      h.sockets[1]!.snapshot.members.find((m) => m.id === "p2")?.claimed,
    ).toBe(true);
  });

  it("enforces short names for renames, claims and roster edits on the server", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:rename", { name: "一二三四五六七八九十十一" });
    expect(h.host.snapshot.members[0]?.name).toBe("一二三四五六七八九十");
    await h.action(h.spectator, "room:claimSeat", {
      seatId: "p1",
      name: "abcdefghijkl",
    });
    expect(h.host.snapshot.members[1]?.name).toBe("abcdefghij");
    await h.action(h.host, "room:setRoster", {
      names: Array(6).fill("abcdefghijk"),
    });
    expect(h.host.snapshot.members.every((m) => m.name.length <= 10)).toBe(
      true,
    );
  });

  it("requires referee authorization and rehydrates a rewound game from persisted events", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    expect(
      (await h.action(h.host, "admin:startAssassination")).error?.code,
    ).toBe("NOT_ADMIN");
    expect((await h.action(h.host, "admin:previousPhase")).error?.code).toBe(
      "NOT_ADMIN",
    );
    const ordinaryPlayer = h.sockets.find(
      (s) => s !== h.spectator && s.game.selfRole !== "Assassin",
    )!;
    expect(
      (
        await h.action(ordinaryPlayer, "game:startAssassination", {
          admin: true,
        })
      ).error?.code,
    ).toBe("NOT_ASSASSIN");
    await h.action(h.host, "admin:auth");
    await h.action(h.host, "admin:startAssassination");
    await h.action(h.host, "admin:previousPhase");
    expect(h.host.game.phase).toBe("TeamBuilding");
    h.wake();
    await h.action(h.spectator, "room:join");
    expect(h.spectator.game.phase).toBe("TeamBuilding");
    expect(
      h.spectator.game.logs.some((log) => log.key === "admin.phaseReturned"),
    ).toBe(true);
    expect(h.spectator.game).not.toHaveProperty("phaseHistory");
    expect(h.spectator.game.players.every((p) => !p.role)).toBe(true);
  });

  it("keeps the room, seats, tokens and previous replay across two games", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    expect((await h.action(h.host, "room:restart")).error?.code).toBe(
      "WRONG_PHASE",
    );
    await h.action(h.host, "room:start");
    const firstId = h.host.game.gameId!;
    const firstSeats = Object.fromEntries(h.host.game.players.map((player) => [player.id, player.seat]));
    await h.finish();
    expect((await h.action(h.spectator, "room:restart")).error?.code).toBe(
      "NOT_HOST",
    );
    const players = h.document.members;
    const sessions = h.document.sessions;
    expect((await h.action(h.host, "room:restart")).ok).toBe(true);
    expect(h.host.snapshot.status).toBe("lobby");
    expect(h.spectator.snapshot.status).toBe("lobby");
    expect(h.document.members).toEqual(players);
    expect(h.document.sessions).toEqual(sessions);
    expect(h.archives.get(firstId)?.outcome?.winner).toBe("evil");
    h.wake();
    await h.action(h.sockets[1]!, "room:join", {
      playerId: "p2",
      playerToken: "token-2",
    });
    expect(h.sockets[1]!.deserializeAttachment().playerId).toBe("p2");
    await h.action(h.host, "room:start");
    const secondId = h.host.game.gameId!;
    expect(secondId).not.toBe(firstId);
    for (const player of h.host.game.players) {
      expect(player.seat).not.toBe(firstSeats[player.id]);
      expect(h.host.snapshot.members.find((member) => member.id === player.id)?.seat).toBe(player.seat);
    }
    expect(h.document.sessions).toEqual(sessions);
    expect(h.host.snapshot.hostPlayerId).toBe('p0');
    expect(h.host.deserializeAttachment().isHost).toBe(true);
    expect(h.host.game.roleAcks).toEqual([]);
    expect(h.host.game.missionResults).toEqual([]);
    expect(h.host.game.previousPhase).toBeUndefined();
    await h.finish();
    expect(h.archives.size).toBe(2);
    expect(h.archives.get(secondId)?.players.map((player) => [player.id, player.seat]))
      .toEqual(h.host.game.players.map((player) => [player.id, player.seat]));
  });

  it("does not acknowledge or broadcast a game finish if the atomic save fails", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    await h.action(h.host, "admin:auth");
    await h.action(h.host, "admin:startAssassination");
    const assassin = h.sockets.find(
      (s) => s !== h.spectator && s.game.selfRole === "Assassin",
    )!;
    const merlin = h.sockets.find(
      (s) => s !== h.spectator && s.game.selfRole === "Merlin",
    )!;
    const before = structuredClone(h.document);
    h.save.mockRejectedValueOnce(new Error("Database unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => { });
    const res = await h.action(assassin, "game:assassinate", {
      targetPlayerId: merlin.deserializeAttachment().playerId,
    });
    expect(res.ok).toBe(false);
    expect(h.document).toEqual(before);
    expect(h.archives.size).toBe(0);
    expect(h.host.game.phase).toBe("Assassination");
    expect(h.host.close).toHaveBeenCalled();
    h.wake();
    expect(
      (
        await h.action(assassin, "game:assassinate", {
          targetPlayerId: merlin.deserializeAttachment().playerId,
        })
      ).ok,
    ).toBe(true);
    expect(h.archives.size).toBe(1);
  });

  it("archives a newer referee correction and retains the completed names when restarting", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:removeSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    const gameId = h.host.game.gameId!;
    await h.finish();
    const first = h.document.archive!.revision as number;
    await h.action(h.host, "admin:previousPhase");
    const assassin = h.sockets.find(
      (s) => s !== h.spectator && s.game.selfRole === "Assassin",
    )!;
    const target = h.sockets.find(
      (s) => s !== h.spectator && s.game.selfRole === "LoyalServant",
    )!;
    expect(
      (
        await h.action(assassin, "game:assassinate", {
          targetPlayerId: target.deserializeAttachment().playerId,
        })
      ).ok,
    ).toBe(true);
    expect(h.archives.get(gameId)?.outcome?.winner).toBe("good");
    expect(h.document.archive!.revision).toBeGreaterThan(first);
    const saved = structuredClone(h.archives.get(gameId));
    await h.action(h.host, "room:leave");
    expect((await h.action(h.host, "room:restart")).ok).toBe(true);
    expect(h.archives.get(gameId)).toEqual(saved);
  });
});
