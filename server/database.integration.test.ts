import { accountKey } from './account-profile';
import { viewContent, type ViewSnapshot } from '@/lib/socket/stateIntegrity';
import { documentHash } from './room-journal';
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";
import type { Ack } from "@/lib/socket/types";
import type { ClientGameState } from "@/lib/engine";
import { PostgresPersistence } from "./database";
import { Room } from "./room";
import { RoomConflict } from "./persistence";
import { normalizeRoleWeights, settledRoleWeights, validRoleAssignment } from '@/lib/engine/roleWeights';
import { startTestAuth } from "./test-auth";
import {
  DEFAULT_ATTACHMENT,
  type RoomSocket,
  type SocketAttachment,
} from "./env";

const url = process.env.TEST_DATABASE_URL;
// Intentionally opt-in: the test suite clears its dedicated database tables.
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL database must end in _test");

class Peer implements RoomSocket {
  attachment: SocketAttachment = { ...DEFAULT_ATTACHMENT, account: crypto.randomUUID() };
  messages: Array<{
    t: string;
    id?: string;
    event?: string;
    payload?: unknown;
    res?: Ack<unknown>;
  }> = [];
  close = vi.fn();
  send(message: string) {
    this.messages.push(JSON.parse(message));
  }
  serializeAttachment(value: SocketAttachment) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  get game() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === "state:sync")?.payload as ClientGameState;
  }
}
let sequence = 0;
async function action(room: Room, peer: Peer, event: string, payload = {}) {
  const id = String(++sequence);
  await room.webSocketMessage(
    peer,
    JSON.stringify({ t: "req", id, event, payload }),
  );
  return peer.messages.find((m) => m.id === id)!.res!;
}

describe.skipIf(!url)("PostgreSQL persistence and recovery", () => {
  let db: PostgresPersistence;
  beforeEach(async () => {
    db = new PostgresPersistence(url!, 4);
    await db.start();
    await db.pool.query(
      "TRUNCATE avalon_room_journal, avalon_rooms, avalon_replays, avalon_profiles, avalon_cards, avalon_game_rewards, avalon_role_weights, avalon_role_weight_games",
    );
  });
  afterEach(async () => {
    await db.close();
    vi.restoreAllMocks();
  });

  it('migrates account preferences, merges concurrent changes and retains them across restart', async () => {
    await db.setAlias('account', 'Existing alias');
    // Simulate an existing installation before the additive preferences migration.
    await db.pool.query('ALTER TABLE avalon_profiles DROP COLUMN preferences');
    await db.pool.query('ALTER TABLE avalon_profiles ALTER COLUMN alias DROP DEFAULT');
    await db.close();
    db = new PostgresPersistence(url!, 4);
    await db.start();
    expect(await db.getPreferences('account')).toEqual({});
    await Promise.all([
      db.savePreferences('account', { locale: 'en' }),
      db.savePreferences('account', { cardArt: 'modern' }),
    ]);
    await db.savePreferences('new-account', { cardArt: 'furry' });
    await db.setAlias('account', 'Updated alias');
    await db.close();
    db = new PostgresPersistence(url!, 4);
    await db.start();
    expect(await db.getPreferences('account')).toEqual({ locale: 'en', cardArt: 'modern' });
    expect(await db.getAlias('account')).toBe('Updated alias');
    expect(await db.getPreferences('new-account')).toEqual({ cardArt: 'furry' });
    expect(await db.getAlias('new-account')).toBeNull();
    expect(await db.getPreferences('other-account')).toEqual({});
  });

  it('appends small changes, verifies recovery, and compacts only the captured version', async () => {
    const room = new Room('1234', db);
    const created = await room.init({ code: '1234', creator: { name: 'Host', account: 'host' } });
    if (!created.ok) throw new Error('init');
    const peer = new Peer(); peer.attachment.account = 'host'; room.addSocket(peer);
    await action(room, peer, 'room:join', { ...created, syncVersion: 1 });
    const first = (await db.loadRoom('1234'))!;
    const rawBefore = (await db.pool.query('SELECT document, snapshot_version FROM avalon_rooms WHERE code = $1', ['1234'])).rows[0];
    await action(room, peer, 'room:rename', { name: 'Renamed' });
    const changed = (await db.loadRoom('1234'))!;
    expect(changed.document.members[0]!.name).toBe('Renamed');
    expect(changed.version).toBe(first.version + 1);
    const rawAfter = (await db.pool.query('SELECT document, snapshot_version FROM avalon_rooms WHERE code = $1', ['1234'])).rows[0];
    expect(rawAfter).toEqual(rawBefore);
    const journal = (await db.pool.query('SELECT entry FROM avalon_room_journal WHERE code = $1 ORDER BY version DESC LIMIT 1', ['1234'])).rows[0].entry;
    expect(JSON.stringify(journal).length).toBeLessThan(JSON.stringify(changed.document).length);
    await action(room, peer, 'room:rename', { name: 'Newest' });
    await db.checkpointRoom('1234', changed.version, changed.document);
    expect((await db.loadRoom('1234'))!.document.members[0]!.name).toBe('Newest');
    expect((await db.pool.query('SELECT count(*)::int AS count FROM avalon_room_journal WHERE code = $1', ['1234'])).rows[0].count).toBe(1);
    const corrupt = structuredClone(changed.document); corrupt.members[0]!.name = 'Broken';
    const current = (await db.loadRoom('1234'))!;
    await expect(db.checkpointRoom('1234', current.version, corrupt)).rejects.toThrow('mismatch');
    expect((await db.loadRoom('1234'))!.document).toEqual(current.document);
    await room.drain();
    expect((await db.pool.query('SELECT count(*)::int AS count FROM avalon_room_journal WHERE code = $1', ['1234'])).rows[0].count).toBe(0);
  });

  it('rejects corrupt snapshots and missing journal tails instead of serving an older game', async () => {
    const room = new Room('1234', db);
    const created = await room.init({ code: '1234', creator: { name: 'Host', account: 'host' } });
    if (!created.ok) throw new Error('init');
    const peer = new Peer(); peer.attachment.account = 'host'; room.addSocket(peer);
    await action(room, peer, 'room:join', created);
    await action(room, peer, 'room:rename', { name: 'Renamed' });
    const saved = (await db.loadRoom('1234'))!;
    const tail = (await db.pool.query('DELETE FROM avalon_room_journal WHERE code = $1 AND version = $2 RETURNING entry', ['1234', saved.version])).rows[0].entry;
    await expect(db.loadRoom('1234')).rejects.toThrow('head');
    await db.pool.query('INSERT INTO avalon_room_journal (code, version, entry) VALUES ($1, $2, $3)', ['1234', saved.version, tail]);
    expect((await db.loadRoom('1234'))!.document).toEqual(saved.document);
    await room.drain();
    await db.pool.query("UPDATE avalon_rooms SET document = jsonb_set(document, '{meta,status}', '\"finished\"') WHERE code = '1234'");
    await expect(db.loadRoom('1234')).rejects.toThrow('snapshot hash');
  });

  it("grants local debug cards atomically without changing reward progress or daily claims", async () => {
    await db.getCards('debug-account', Date.now());
    await db.pool.query("UPDATE avalon_cards SET cards = 0, completed_games = 4 WHERE account = 'debug-account'");
    const before = await db.getCards('debug-account');
    expect(await db.grantDebugCard('debug-account')).toEqual({ ...before, cards: 1 });
    await Promise.all(Array.from({ length: 5 }, () => db.grantDebugCard('debug-account')));
    expect(await db.getCards('debug-account')).toEqual({ ...before, cards: 2 });
    expect(await db.grantDebugCard('new-debug-account')).toEqual({ cards: 1, completedGames: 0, lastDailyDay: null });
  });

  async function setup(account = 'host-account') {
    const room = new Room("1234", db);
    const created = await room.init({
      code: "1234",
      creator: { name: "Host" },
      roster: ["A", "B", "C", "D", "E"],
    });
    if (!created.ok) throw new Error("Could not create room");
    const peers = Array.from({ length: 5 }, () => new Peer());
    peers[0]!.attachment.account = account;
    peers.forEach((p) => room.addSocket(p));
    await action(room, peers[0]!, "room:join", created);
    const record = (await db.loadRoom("1234"))!;
    const tokens = [
      {
        playerId: created.playerId,
        playerToken: created.playerToken,
        hostToken: created.hostToken,
      },
    ];
    for (let seat = 1; seat < 5; seat++) {
      const res = await action(room, peers[seat]!, "room:claimSeat", {
        seatId: record.document.members[seat]!.id,
      });
      tokens.push(res.data as (typeof tokens)[number]);
    }
    expect((await action(room, peers[0]!, "room:start")).ok).toBe(true);
    return { room, peers, tokens, created };
  }

  async function finishWeightedGame(room: Room, peers: Peer[]) {
    await action(room, peers[0]!, 'admin:auth');
    expect((await action(room, peers[0]!, 'admin:startAssassination')).ok).toBe(true);
    const assassin = peers.find((peer) => peer.game.selfRole === 'Assassin')!;
    const merlin = peers.find((peer) => peer.game.selfRole === 'Merlin')!;
    expect((await action(room, assassin, 'game:assassinate', { targetPlayerId: merlin.attachment.playerId })).ok).toBe(true);
  }

  it('settles final role weights once and preserves concurrent cross-room updates across restart', async () => {
    const { room, peers } = await setup('shared-account');
    expect((await db.getRoleWeights(['shared-account']))['shared-account']).toBeUndefined();
    await action(room, peers[0]!, 'admin:auth');
    expect((await action(room, peers[0]!, 'admin:rerollRoles')).ok).toBe(true);
    expect((await db.getRoleWeights(['shared-account']))['shared-account']).toBeUndefined();
    const finalRole = peers[0]!.game.selfRole!;
    await finishWeightedGame(room, peers);
    const first = settledRoleWeights(undefined, finalRole);
    expect((await db.getRoleWeights(['shared-account']))['shared-account']).toEqual(first);
    const saved = (await db.loadRoom('1234'))!;
    await db.saveRoom('1234', saved.version, saved.document);
    expect((await db.getRoleWeights(['shared-account']))['shared-account']).toEqual(first);

    const documents = ['5678', '9012'].map((code) => {
      const document = structuredClone(saved.document);
      document.meta.code = code;
      document.meta.gameId = `weighted-${code}`;
      document.archive!.replay.gameId = document.meta.gameId;
      return document;
    });
    await Promise.all(documents.map((document) => db.saveRoom(document.meta.code, 0, document)));
    const expected = settledRoleWeights(settledRoleWeights(first, finalRole), finalRole);
    expect((await db.getRoleWeights(['shared-account']))['shared-account']).toEqual(expected);
    expect(expected[finalRole]).toBe(50);
    await db.close();
    db = new PostgresPersistence(url!, 4);
    await db.start();
    expect((await db.getRoleWeights(['shared-account']))['shared-account']).toEqual(expected);
  });

  it('uses ordinary dealing if the optional weight store is unavailable', async () => {
    await db.pool.query('ALTER TABLE avalon_role_weights RENAME TO test_unavailable_role_weights');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { peers } = await setup('fallback-account');
      const saved = (await db.loadRoom('1234'))!.document;
      expect(peers[0]!.game.phase).toBe('TeamBuilding');
      expect(validRoleAssignment(saved.game!.config.roles, saved.game!.players.map((player) => player.role))).toBe(true);
      expect(saved.events.find(({ event }) => event.type === 'START_GAME')!.event).not.toHaveProperty('assignedRoles');
    } finally {
      await db.pool.query('ALTER TABLE test_unavailable_role_weights RENAME TO avalon_role_weights');
    }
  });

  it('retains a completed game if preference settlement fails and safely retries it once', async () => {
    const { room, peers } = await setup('optional-account');
    const role = peers[0]!.game.selfRole!;
    await db.pool.query('ALTER TABLE avalon_role_weights ADD CONSTRAINT test_reject_weights CHECK (false)');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await finishWeightedGame(room, peers);
      const saved = (await db.loadRoom('1234'))!.document;
      expect(saved.game?.phase).toBe('GameOver');
      expect((await db.loadReplay(saved.meta.gameId!))?.outcome).toBeTruthy();
      expect(await db.getRoleWeights(['optional-account'])).toEqual({});
      expect((await db.pool.query('SELECT * FROM avalon_role_weight_games')).rowCount).toBe(0);
    } finally {
      await db.pool.query('ALTER TABLE avalon_role_weights DROP CONSTRAINT test_reject_weights');
    }
    const saved = (await db.loadRoom('1234'))!;
    const next = await db.saveRoom('1234', saved.version, saved.document);
    expect((await db.getRoleWeights(['optional-account']))['optional-account']).toEqual(settledRoleWeights(undefined, role));
    await db.saveRoom('1234', next, saved.document);
    expect((await db.getRoleWeights(['optional-account']))['optional-account']).toEqual(settledRoleWeights(undefined, role));
  });

  it('rolls preference changes and their deduplication markers back with a failed game commit', async () => {
    const { room, peers } = await setup('atomic-account');
    await action(room, peers[0]!, 'admin:auth');
    await action(room, peers[0]!, 'admin:startAssassination');
    const assassin = peers.find((peer) => peer.game.selfRole === 'Assassin')!;
    const merlin = peers.find((peer) => peer.game.selfRole === 'Merlin')!;
    const target = { targetPlayerId: merlin.attachment.playerId };
    const original = db.pool.connect.bind(db.pool);
    vi.spyOn(db.pool, 'connect').mockImplementationOnce(async () => {
      const client = await original();
      const query = client.query.bind(client);
      const interception = vi.spyOn(client, 'query').mockImplementation(((...args: Parameters<typeof client.query>) => {
        if (args[0] === 'COMMIT') {
          interception.mockRestore();
          throw new Error('Simulated commit failure');
        }
        return query(...args);
      }) as typeof client.query);
      return client;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await action(room, assassin, 'game:assassinate', target)).ok).toBe(false);
    expect((await db.loadRoom('1234'))!.document.game?.phase).toBe('Assassination');
    expect(await db.getRoleWeights(['atomic-account'])).toEqual({});
    expect((await db.pool.query('SELECT * FROM avalon_role_weight_games')).rowCount).toBe(0);
    const recovered = new Room('1234', db);
    peers.forEach((peer) => recovered.addSocket(peer));
    expect((await action(recovered, assassin, 'game:assassinate', target)).ok).toBe(true);
    expect((await db.getRoleWeights(['atomic-account']))['atomic-account'])
      .toEqual(settledRoleWeights(normalizeRoleWeights(undefined), peers[0]!.game.selfRole!));
  });

  it("claims concurrently once per reward day and consumes full-wallet claims", async () => {
    const before = Date.parse('2026-09-29T19:59:59.999Z');
    await Promise.all(Array.from({ length: 12 }, () => db.getCards('account-a', before)));
    expect((await db.getCards('account-a')).cards).toBe(1);
    await db.getCards('account-a', before + 1);
    expect((await db.getCards('account-a')).cards).toBe(2);
    await db.getCards('account-a', before + 86400001);
    await db.pool.query("UPDATE avalon_cards SET cards = 1 WHERE account = 'account-a'");
    expect((await db.getCards('account-a', before + 86400001)).cards).toBe(1);
    expect((await db.getCards('account-b')).cards).toBe(0);
  });

  it("rolls back a card debit together with a failed room save and prevents concurrent overspending", async () => {
    await setup('account-a');
    await db.getCards('account-a', Date.now());
    const before = (await db.loadRoom('1234'))!;
    // Force an error after the debit, during the archive write.
    const invalid = structuredClone(before.document);
    invalid.archive = { replay: { outcome: null } as unknown as NonNullable<typeof invalid.archive>['replay'], revision: 1 };
    await expect(db.saveRoom('1234', before.version, invalid, 'account-a')).rejects.toThrow('Cannot archive');
    expect((await db.getCards('account-a')).cards).toBe(1);
    expect(await db.loadRoom('1234')).toEqual(before);
    const other = structuredClone(before.document);
    other.meta.code = '5678';
    const results = await Promise.allSettled([
      db.saveRoom('1234', before.version, before.document, 'account-a'),
      db.saveRoom('5678', 0, other, 'account-a'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.getCards('account-a')).cards).toBe(0);
  });

  it("awards one card per five settled games, deduplicates resaves, and survives a database restart", async () => {
    const prepared = await setup('account-a');
    let room = prepared.room;
    const { peers } = prepared;
    let previousSeats: Record<string, number> = {};
    for (let game = 1; game <= 5; game++) {
      for (const player of peers[0]!.game.players) expect(player.seat).not.toBe(previousSeats[player.id]);
      previousSeats = Object.fromEntries(peers[0]!.game.players.map((player) => [player.id, player.seat]));
      await action(room, peers[0]!, 'admin:auth');
      await action(room, peers[0]!, 'admin:startAssassination');
      const assassin = peers.find((p) => p.game.selfRole === 'Assassin')!;
      const merlin = peers.find((p) => p.game.selfRole === 'Merlin')!;
      expect((await action(room, assassin, 'game:assassinate', { targetPlayerId: merlin.attachment.playerId })).ok).toBe(true);
      expect(await db.getCards('account-a')).toMatchObject({ completedGames: game, cards: game === 5 ? 1 : 0 });
      // Ordinary room changes keep saving the archive but must not count again.
      await action(room, peers[0]!, 'admin:close');
      expect((await db.getCards('account-a')).completedGames).toBe(game);
      if (game < 5) {
        await action(room, peers[0]!, 'room:restart');
        if (game === 2) {
          await db.close();
          db = new PostgresPersistence(url!, 4);
          await db.start();
          room = new Room('1234', db);
          peers.forEach((peer) => room.addSocket(peer));
        }
        await action(room, peers[0]!, 'room:start');
      }
    }
    await db.close();
    db = new PostgresPersistence(url!, 4);
    await db.start();
    expect(await db.getCards('account-a')).toMatchObject({ completedGames: 5, cards: 1 });
  });

  it("restores roles, acknowledgements, paused timers, tokens and private notes after every runtime and pool is discarded", async () => {
    const { room, peers, tokens } = await setup();
    const gameId = peers[0]!.game.gameId!;
    const notes = {
      gameId,
      roleRevision: peers[0]!.game.roleRevision,
      playerId: tokens[0]!.playerId,
    };
    await action(room, peers[0]!, "game:ackRole", {
      roleRevision: peers[0]!.game.roleRevision,
    });
    await action(room, peers[0]!, "admin:auth");
    await action(room, peers[0]!, "admin:setTimersPaused", { paused: true });
    await action(room, peers[0]!, "notes:sync", {
      ...notes,
      update: {
        baseRevision: 0,
        enabled: false,
        notes: { [tokens[1]!.playerId]: "Merlin" },
      },
    });
    const before = (await db.loadRoom("1234"))!.document;
    await db.setAlias("account", "Saved alias");
    await db.close();
    db = new PostgresPersistence(url!, 4);
    await db.start();
    const recovered = new Room("1234", db);
    const viewer = new Peer();
    viewer.attachment.account = peers[0]!.attachment.account;
    recovered.addSocket(viewer);
    expect((await action(recovered, viewer, "room:join", tokens[0]!)).ok).toBe(
      true,
    );
    const after = (await db.loadRoom("1234"))!.document;
    expect(after.game?.players.map((p) => [p.id, p.role])).toEqual(
      before.game?.players.map((p) => [p.id, p.role]),
    );
    expect(after.game?.roleAcks).toEqual(before.game?.roleAcks);
    expect(after.game?.actionTimers).toEqual(before.game?.actionTimers);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.lastGameSeats).toEqual(before.lastGameSeats);
    expect(viewer.game.gameId).toBe(gameId);
    expect(viewer.game.players.filter((p) => p.connected)).toHaveLength(1);
    expect((await action(recovered, viewer, "notes:sync", notes)).data).toEqual(
      before.notes[tokens[0]!.playerId],
    );
    expect(await db.getAlias("account")).toBe("Saved alias");
    const spectator = new Peer();
    recovered.addSocket(spectator);
    await action(recovered, spectator, "room:join");
    expect(spectator.game.selfRole).toBeNull();
    expect(JSON.stringify(spectator.messages)).not.toContain("playerToken");
  });

  it("serializes simultaneous commands without losing acknowledged role confirmations", async () => {
    const { room, peers, tokens } = await setup();
    const results = await Promise.all(
      peers.map((peer) =>
        action(room, peer, "game:ackRole", {
          roleRevision: peer.game.roleRevision,
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const saved = (await db.loadRoom("1234"))!;
    expect(saved.document.game?.roleAcks.sort()).toEqual(
      tokens.map((t) => t.playerId).sort(),
    );
    expect(saved.document.game?.phase).toBe("TeamBuilding");
    expect(new Set(saved.document.events.map((e) => e.seq)).size).toBe(
      saved.document.events.length,
    );
  });

  it.each(["Voting", "MissionVote"])(
    "recovers unfinished %s submissions without revealing their values",
    async (phase) => {
      const { room, peers, tokens } = await setup();
      for (const peer of peers)
        await action(room, peer, "game:ackRole", {
          roleRevision: peer.game.roleRevision,
        });
      const leader = peers.find((peer) =>
        peer.game.players.some(
          (p) => p.id === peer.attachment.playerId && p.isLeader,
        ),
      )!;
      const team = tokens.slice(0, 2).map((token) => token.playerId);
      expect(
        (await action(room, leader, "game:proposeTeam", { team })).ok,
      ).toBe(true);
      expect(leader.game.phase).toBe("TeamAnnouncement");
      expect((await action(room, leader, "game:startDiscussion")).ok).toBe(true);
      for (const playerId of leader.game.discussion!.order) {
        expect(
          (
            await action(
              room,
              peers.find((peer) => peer.attachment.playerId === playerId)!,
              "game:endSpeech",
            )
          ).ok,
        ).toBe(true);
      }
      expect(
        (await action(room, leader, "game:finalizeTeam", { team })).ok,
      ).toBe(true);
      for (const peer of peers.slice(0, phase === "Voting" ? 2 : 5)) {
        expect(
          (await action(room, peer, "game:vote", { value: "approve" })).ok,
        ).toBe(true);
      }
      if (phase === "MissionVote") {
        expect(
          (
            await action(room, peers[0]!, "game:missionCard", {
              card: "success",
            })
          ).ok,
        ).toBe(true);
      }
      const before = (await db.loadRoom("1234"))!.document;
      expect(before.game?.phase).toBe(phase);
      await db.close();
      db = new PostgresPersistence(url!, 4);
      await db.start();
      const restored = new Room("1234", db);
      const peer = new Peer();
      restored.addSocket(peer);
      await action(restored, peer, "room:join", tokens[0]!);
      const after = (await db.loadRoom("1234"))!.document;
      expect(after.game?.votes).toEqual(before.game?.votes);
      expect(after.game?.missionCards).toEqual(before.game?.missionCards);
      expect(after.game?.actionTimers).toEqual(before.game?.actionTimers);
      expect(peer.game.phase).toBe(phase);
      const spectator = new Peer();
      restored.addSocket(spectator);
      await action(restored, spectator, "room:join");
      expect(spectator.game).not.toHaveProperty("missionCards");
      if (phase === "Voting")
        expect(
          spectator.game.votes?.every((vote) => vote.vote === undefined),
        ).toBe(true);
    },
  );

  it("recovers the same game and seat through a real WebSocket after SIGKILL of the Node server", async () => {
    const auth = await startTestAuth();
    const { room, peers, tokens } = await setup(accountKey(auth.env.OIDC_ISSUER, 'test-user'));
    await action(room, peers[0]!, "game:ackRole", {
      roleRevision: peers[0]!.game.roleRevision,
    });
    const expected = peers[0]!.game;
    await db.close();
    let child: ChildProcess | undefined;
    let ws: WebSocket | undefined;
    const origin = "http://localhost:55440";
    async function start() {
      child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...auth.env,
          DATABASE_URL: url!,
          PORT: "55440",
          HOST: "127.0.0.1",
          PUBLIC_ORIGIN: origin,
          ENVIRONMENT: "development",
        },
      });
      let output = "";
      child.stdout!.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr!.on("data", (chunk) => {
        output += chunk;
      });
      await vi.waitFor(
        async () => {
          if (child!.exitCode !== null) throw new Error(output);
          expect(
            (await fetch("http://127.0.0.1:55440/api/health")).status,
          ).toBe(200);
        },
        { timeout: 10_000, interval: 100 },
      );
      const unauthorized = await fetch(
        "http://127.0.0.1:55440/api/auth/alias",
        {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ alias: "No session" }),
        },
      );
      expect(unauthorized.status).toBe(401);
      const rejected = new WebSocket("ws://127.0.0.1:55440/rooms/1234/ws", { origin });
      await expect(once(rejected, 'open')).rejects.toThrow('401');
      ws = new WebSocket("ws://127.0.0.1:55440/rooms/1234/ws", {
        origin, headers: { Cookie: await auth.cookie() },
      });
      await once(ws, "open");
      const messages: Array<{
        t: string;
        id?: string;
        event?: string;
        payload?: unknown;
        res?: Ack<unknown>;
      }> = [];
      ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
      ws.send(
        JSON.stringify({
          t: "req",
          id: "join",
          event: "room:join",
          payload: { ...tokens[0], syncVersion: 1 },
        }),
      );
      await vi.waitFor(() =>
        expect(messages.find((m) => m.id === "join")?.res?.ok).toBe(true),
      );
      const synced = messages.find((m) => m.event === 'view:sync')!.payload as ViewSnapshot;
      expect(synced.hash).toBe(documentHash(viewContent(synced.view)));
      const game = synced.view.game!;
      expect(game.gameId).toBe(expected.gameId);
      expect(game.selfRole).toBe(expected.selfRole);
      expect(game.players.filter((p) => p.connected)).toHaveLength(1);
      return game;
    }
    async function stop(signal: NodeJS.Signals) {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill(signal);
        await exited;
      }
      ws?.terminate();
    }
    try {
      await start();
      await stop("SIGKILL");
      const restored = await start();
      expect(restored.phase).toBe(expected.phase);
      await stop("SIGTERM");
    } finally {
      await stop("SIGKILL");
      await auth.close();
      db = new PostgresPersistence(url!, 4);
      await db.start();
    }
    const saved = (await db.loadRoom("1234"))!.document;
    expect(saved.game?.roleAcks).toContain(tokens[0]!.playerId);
    expect(saved.members[0]!.claimed).toBe(true);
  }, 30_000);

  it("buffers all public and private pushes until PostgreSQL commits and does not write on latency heartbeats", async () => {
    const { room, peers } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = db.saveRoom.bind(db);
    const save = vi
      .spyOn(db, "saveRoom")
      .mockImplementationOnce(async (...args) => {
        await gate;
        return original(...args);
      });
    const count = peers[0]!.messages.length;
    const request = action(room, peers[0]!, "game:ackRole", {
      roleRevision: peers[0]!.game.roleRevision,
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(peers[0]!.messages).toHaveLength(count);
    release();
    expect((await request).ok).toBe(true);
    save.mockClear();
    await action(room, peers[0]!, "net:ping", { rtt: 123 });
    expect(save).not.toHaveBeenCalled();
  });

  it("atomically rolls back the game finish if replay storage fails, then archives a retry and keeps it through room restart", async () => {
    const { room, peers } = await setup();
    await action(room, peers[0]!, "admin:auth");
    await action(room, peers[0]!, "admin:startAssassination");
    const assassin = peers.find((p) => p.game.selfRole === "Assassin")!;
    const merlin = peers.find((p) => p.game.selfRole === "Merlin")!;
    const target = { targetPlayerId: merlin.attachment.playerId };
    const before = (await db.loadRoom("1234"))!;
    await db.pool.query(
      `ALTER TABLE avalon_replays ADD CONSTRAINT test_reject_replay CHECK (revision < 0)`,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        (await action(room, assassin, "game:assassinate", target)).ok,
      ).toBe(false);
      expect(await db.loadRoom("1234")).toEqual(before);
      expect(await db.loadReplay(before.document.meta.gameId!)).toBeNull();
      expect(peers[0]!.game.phase).toBe("Assassination");
    } finally {
      await db.pool.query(
        "ALTER TABLE avalon_replays DROP CONSTRAINT test_reject_replay",
      );
    }
    const recovered = new Room("1234", db);
    peers.forEach((p) => recovered.addSocket(p));
    expect(
      (await action(recovered, assassin, "game:assassinate", target)).ok,
    ).toBe(true);
    const replay = await db.loadReplay(before.document.meta.gameId!);
    expect(replay?.outcome?.winner).toBe("evil");
    await action(recovered, peers[0]!, "room:restart");
    expect((await db.loadRoom("1234"))!.document.game).toBeNull();
    expect(await db.loadReplay(before.document.meta.gameId!)).toEqual(replay);
    await db.close();
    db = new PostgresPersistence(url!, 4);
    await db.start();
    expect(await db.loadReplay(before.document.meta.gameId!)).toEqual(replay);
  });

  it("rejects a second process and stale versions and fences writes after ownership changes", async () => {
    await setup();
    const duplicate = new PostgresPersistence(url!, 2);
    try {
      await expect(duplicate.start()).rejects.toThrow("Another Avalon");
    } finally {
      await duplicate.close();
    }
    const saved = (await db.loadRoom("1234"))!;
    await expect(
      db.saveRoom("1234", saved.version - 1, saved.document),
    ).rejects.toBeInstanceOf(RoomConflict);
    await db.pool.query(
      "UPDATE avalon_runtime SET token = 'different-process' WHERE id = 1",
    );
    await expect(
      db.saveRoom("1234", saved.version, saved.document),
    ).rejects.toThrow("ownership lost");
    expect(await db.loadRoom("1234")).toEqual(saved);
  });

  it("keeps the newest replay revision when an older snapshot is saved", async () => {
    const { room, peers } = await setup();
    await action(room, peers[0]!, "admin:auth");
    await action(room, peers[0]!, "admin:startAssassination");
    const assassin = peers.find((p) => p.game.selfRole === "Assassin")!;
    await action(room, assassin, "game:assassinate", {
      targetPlayerId: peers.find((p) => p.game.selfRole === "Merlin")!
        .attachment.playerId,
    });
    const old = (await db.loadRoom("1234"))!;
    const corrected = structuredClone(old.document);
    corrected.archive!.revision += 10;
    corrected.archive!.replay.players[0]!.name = "Corrected";
    const version = await db.saveRoom("1234", old.version, corrected);
    await db.saveRoom("1234", version, old.document);
    expect(
      (await db.loadReplay(old.document.meta.gameId!))?.players[0]!.name,
    ).toBe("Corrected");
  });
});
