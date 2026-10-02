import type { RoleNotesDocument } from "@/lib/game/roleNotes";
import type { Ack } from "@/lib/socket/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe("private role note storage", () => {
  it("persists notes across runtime recreation and account reconnect without public broadcasts or game events", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:join", { playerId: "p0", playerToken: "token-0", hostToken: "host-secret" });
    await h.action(h.host, "room:start");
    const scope = {
      gameId: h.host.game.gameId!,
      roleRevision: h.host.game.roleRevision,
      playerId: "p0",
    };
    const counts = h.sockets.slice(1).map((s) => s.messages.length);
    const events = h.document.events.length;
    const saved = (await h.action(h.host, "notes:sync", {
      ...scope,
      update: {
        baseRevision: 0,
        notes: { p2: "percival-claim", p3: "Merlin" },
        enabled: false,
      },
    })) as Ack<RoleNotesDocument>;
    expect(saved.data).toMatchObject({
      ...scope,
      revision: 1,
      notes: { p2: "percival-claim", p3: "Merlin" },
      enabled: false,
    });
    expect(h.sockets.slice(1).map((s) => s.messages.length)).toEqual(counts);
    expect(h.document.events.length).toEqual(events);
    h.wake();
    const replacement = new Socket({ account: "account-0", isHost: false, isAdmin: false });
    h.sockets.push(replacement);
    await h.action(replacement, "room:join");
    const restored = await h.action(replacement, "notes:sync", scope);
    expect(restored.data).toEqual(saved.data);
    expect((await h.action(h.host, "notes:sync", scope)).error?.code).toBe(
      "RECONNECT",
    );
    expect(JSON.stringify(replacement.snapshot)).not.toContain(
      "percival-claim",
    );
    expect(JSON.stringify(replacement.game)).not.toContain("percival-claim");
    expect(replacement.game.selfRole).toBe(h.document.game!.players.find((player) => player.id === 'p0')!.role);
    expect((await h.action(replacement, 'game:ackRole', { roleRevision: replacement.game.roleRevision })).ok).toBe(true);
  });

  it("restores seat notes when a new device reclaims a released seat", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:start");
    const scope = {
      gameId: h.host.game.gameId!,
      roleRevision: h.host.game.roleRevision,
      playerId: "p0",
    };
    await h.action(h.host, "notes:sync", {
      ...scope,
      update: { baseRevision: 0, notes: { p2: "Merlin" }, enabled: true },
    });
    await h.action(h.host, "room:releaseSeat");
    await h.action(h.spectator, "room:claimSeat", { seatId: "p0" });
    expect(
      (await h.action(h.spectator, "notes:sync", scope)).data,
    ).toMatchObject({ notes: { p2: "Merlin" }, revision: 1 });
    expect((await h.action(h.host, "notes:sync", scope)).error?.code).toBe(
      "NOT_SEATED",
    );
  });

  it("rejects spectators, seat spoofing, malformed data and stale scopes while isolating every seat", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:start");
    const scope = {
      gameId: h.host.game.gameId!,
      roleRevision: h.host.game.roleRevision,
      playerId: "p0",
    };
    await h.action(h.spectator, "admin:auth");
    expect((await h.action(h.spectator, "notes:sync", scope)).error?.code).toBe(
      "NOT_SEATED",
    );
    expect(
      (await h.action(h.sockets[1]!, "notes:sync", scope)).error?.code,
    ).toBe("STALE_NOTES_SCOPE");
    expect(
      (
        await h.action(h.host, "notes:sync", {
          ...scope,
          gameId: "another-game",
        })
      ).error?.code,
    ).toBe("STALE_NOTES_SCOPE");
    expect(
      (await h.action(h.host, "notes:sync", { ...scope, roleRevision: 99 }))
        .error?.code,
    ).toBe("STALE_NOTES_SCOPE");
    for (const notes of [
      [],
      { unknown: "Merlin" },
      { p1: "invalid-role" },
      { p1: 123 },
    ]) {
      expect(
        (
          await h.action(h.host, "notes:sync", {
            ...scope,
            update: { baseRevision: 0, enabled: true, notes },
          })
        ).error?.code,
      ).toBe("INVALID");
    }
    await h.action(h.host, "notes:sync", {
      ...scope,
      update: { baseRevision: 0, enabled: true, notes: { p2: "Merlin" } },
    });
    expect(
      (
        await h.action(h.sockets[1]!, "notes:sync", {
          ...scope,
          playerId: "p2",
        })
      ).data,
    ).toMatchObject({ notes: {}, revision: 0 });
  });

  it("uses revisions to prevent stale overwrites and persists an explicit clear", async () => {
    const h = roomHarness();
    await h.action(h.host, "room:start");
    const scope = {
      gameId: h.host.game.gameId!,
      roleRevision: h.host.game.roleRevision,
      playerId: "p0",
    };
    const update = { baseRevision: 0, enabled: true, notes: { p2: "Merlin" } };
    expect(
      (await h.action(h.host, "notes:sync", { ...scope, update })).ok,
    ).toBe(true);
    const conflict = await h.action(h.host, "notes:sync", { ...scope, update });
    expect(conflict.error?.code).toBe("NOTES_CONFLICT");
    expect(conflict.data).toMatchObject({
      revision: 1,
      notes: { p2: "Merlin" },
    });
    await h.action(h.host, "notes:sync", {
      ...scope,
      update: { baseRevision: 1, notes: {}, enabled: false },
    });
    h.wake();
    expect((await h.action(h.host, "notes:sync", scope)).data).toMatchObject({
      revision: 2,
      notes: {},
      enabled: false,
    });
  });

  it("resets notes on role reassignment and a new game without adding them to the replay", async () => {
    const h = roomHarness();
    const extraPlayer = new Socket({ account: "viewer-account", isHost: false, isAdmin: false });
    h.sockets.push(extraPlayer);
    await h.action(extraPlayer, "room:claimSeat", { seatId: "p1" });
    await h.action(h.host, "room:start");
    const scope = {
      gameId: h.host.game.gameId!,
      roleRevision: h.host.game.roleRevision,
      playerId: "p0",
    };
    await h.action(h.host, "notes:sync", {
      ...scope,
      update: {
        baseRevision: 0,
        notes: { p2: "percival-claim" },
        enabled: false,
      },
    });
    await h.action(h.host, "admin:auth");
    await h.action(h.host, "admin:rerollRoles");
    expect((await h.action(h.host, "notes:sync", scope)).error?.code).toBe(
      "STALE_NOTES_SCOPE",
    );
    const reassigned = { ...scope, roleRevision: h.host.game.roleRevision };
    expect(
      (await h.action(h.host, "notes:sync", reassigned)).data,
    ).toMatchObject({ revision: 0, notes: {}, enabled: true });
    await h.action(h.host, "notes:sync", {
      ...reassigned,
      update: {
        baseRevision: 0,
        notes: { p2: "percival-claim" },
        enabled: false,
      },
    });
    await h.finish();
    expect(JSON.stringify([...h.archives.values()])).not.toContain(
      "percival-claim",
    );
    await h.action(h.host, "room:restart");
    expect(Object.values(h.document.notes)).toEqual([]);
    await h.action(h.host, "room:start");
    expect((await h.action(h.host, "notes:sync", reassigned)).error?.code).toBe(
      "STALE_NOTES_SCOPE",
    );
  });
});
