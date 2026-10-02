import { ALL_ROLES, normalizeRoleWeights, settledRoleWeights, validRoleAssignment } from '@/lib/engine/roleWeights';
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientGameState } from "@/lib/engine";
import type { Ack, RoomSnapshot } from "@/lib/socket/types";
import type { RoleNotesDocument } from "@/lib/game/roleNotes";
import { DEFAULT_ROOM_CONFIG } from "./room-helpers";
import type { RoomSocket, SocketAttachment } from "./env";
import type { RoomDocument } from "./persistence";
import { MemoryPersistence } from "./test-persistence";

import { Room } from "./room";

class Socket {
  messages: Array<{
    t: string;
    id?: string;
    event?: string;
    payload?: unknown;
    res?: Ack<unknown>;
  }> = [];
  constructor(private attachment: SocketAttachment) {}
  deserializeAttachment() {
    return this.attachment;
  }
  serializeAttachment(attachment: SocketAttachment) {
    this.attachment = attachment;
  }
  send(message: string) {
    this.messages.push(JSON.parse(message));
  }
  close = vi.fn();
  get ws(): RoomSocket {
    return this;
  }
  get game() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === "state:sync")!.payload as ClientGameState;
  }
  get snapshot() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === "room:snapshot")!.payload as RoomSnapshot;
  }
}

afterEach(() => vi.restoreAllMocks());

function roomHarness(seedRoom = true) {
  const sockets = [0, 2, 3, 4, 5].map(
    (seat) =>
      new Socket({ account: `account-${seat}`, playerId: `p${seat}`, isHost: seat === 0, isAdmin: false }),
  );
  const spectator = new Socket({ account: "viewer-account", isHost: false, isAdmin: false });
  sockets.push(spectator);
  const persistence = new MemoryPersistence();
  const save = vi.spyOn(persistence, "saveRoom");
  const archives = persistence.archives;
  if (seedRoom) {
    const document: RoomDocument = {
      schemaVersion: 1,
      meta: {
        code: "1234",
        hostToken: "host-secret",
        status: "lobby",
        gameId: null,
        seed: null,
        config: {
          ...DEFAULT_ROOM_CONFIG,
          roster: Array.from({ length: 6 }, (_, i) => `Seat ${i}`),
        },
      },
      members: Array.from({ length: 6 }, (_, seat) => ({
        id: `p${seat}`,
        name: `Player ${seat}`,
        avatarUrl: `https://example.com/${seat}.png`,
        seat,
        isSpectator: false,
        claimed: seat !== 1,
        connected: seat !== 1,
      })),
      sessions: Object.fromEntries(
        [0, 2, 3, 4, 5].map((seat) => [`p${seat}`, `token-${seat}`]),
      ),
      notes: {},
      game: null,
      eventSeq: 0,
      events: [],
      archive: null,
    };
    persistence.rooms.set("1234", { version: 1, document });
  }
  let room = new Room("1234", persistence);
  for (const socket of sockets) room.addSocket(socket);
  let request = 0;
  const action = async (socket: Socket, event: string, payload = {}) => {
    const id = String(++request);
    room.addSocket(socket);
    await room.webSocketMessage(
      socket.ws,
      JSON.stringify({ t: "req", id, event, payload }),
    );
    return socket.messages.find((m) => m.t === "ack" && m.id === id)!.res!;
  };
  const host = sockets[0]!;
  const finish = async () => {
    expect((await action(host, "admin:auth")).ok).toBe(true);
    expect((await action(host, "admin:startAssassination")).ok).toBe(true);
    const assassin = sockets.find(
      (s) => s !== spectator && s.game.selfRole === "Assassin",
    )!;
    const merlin = sockets.find(
      (s) => s !== spectator && s.game.selfRole === "Merlin",
    )!;
    expect(
      (
        await action(assassin, "game:assassinate", {
          targetPlayerId: merlin.deserializeAttachment().playerId,
        })
      ).ok,
    ).toBe(true);
  };
  return {
    get room() {
      return room;
    },
    get document() {
      return persistence.rooms.get("1234")!.document;
    },
    persistence,
    save,
    host,
    sockets,
    spectator,
    action,
    archives,
    finish,
    wake: () => {
      room = new Room("1234", persistence);
      for (const socket of sockets) room.addSocket(socket);
    },
  };
}

describe('recommended lobby configuration', () => {
  it('resets custom rules, follows occupied seats in both directions, and survives reload before dealing', async () => {
    const h = roomHarness();
    expect((await h.action(h.host, 'room:config', { config: {
      ...DEFAULT_ROOM_CONFIG,
      useRecommended: true,
      options: { ...DEFAULT_ROOM_CONFIG.options, oberon: true, mordred: true, ladyOfTheLake: true, maxRejections: 2, speechSeconds: 600 },
    } })).ok).toBe(true);
    expect(h.host.snapshot.config.options).toMatchObject({ oberon: false, mordred: false, ladyOfTheLake: false, maxRejections: 5, speechSeconds: 120 });
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    expect(h.host.snapshot.config.options.oberon).toBe(false);
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    expect(h.spectator.snapshot.config.options.oberon).toBe(true);
    const bot = h.host.snapshot.members.find((member) => member.isBot)!;
    expect((await h.action(h.host, 'room:kick', { targetPlayerId: bot.id })).ok).toBe(true);
    expect(h.spectator.snapshot.config.options.oberon).toBe(false);
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    h.wake();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.document.game!.config.options).toMatchObject({ oberon: true, mordred: false, ladyOfTheLake: false, maxRejections: 5, speechSeconds: 120 });
    expect(h.document.game!.config.roles).toContain('Oberon');
  });

  it('allows custom settings again when the host turns recommendations off', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:config', { config: { ...DEFAULT_ROOM_CONFIG, useRecommended: true } });
    expect((await h.action(h.host, 'room:config', { config: {
      ...h.host.snapshot.config, useRecommended: false,
      options: { ...DEFAULT_ROOM_CONFIG.options, maxRejections: 2, speechSeconds: 60 },
    } })).ok).toBe(true);
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.document.game!.config.options).toMatchObject({ maxRejections: 2, speechSeconds: 60 });
  });
});

describe('account-only socket access', () => {
  it.each(['room:join', 'room:claimSeat', 'room:start', 'admin:auth', 'notes:sync', 'game:vote', 'net:ping'])(
    'rejects %s without a verified account, even with old tokens or a forged payload',
    async (event) => {
      const h = roomHarness();
      const signedOut = new Socket({ isHost: true, isAdmin: true, playerId: 'p0' });
      const before = structuredClone(h.document);
      const result = await h.action(signedOut, event, {
        account: 'account-0', code: '1234', name: 'Old guest', seatId: 'p1',
        playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret', value: 'approve',
      });
      expect(result.error?.code).toBe('AUTH_REQUIRED');
      expect(signedOut.close).toHaveBeenCalledWith(1008, 'Sign in to enter a room');
      expect(h.document).toEqual(before);
      expect(h.save).not.toHaveBeenCalled();
      await h.action(h.spectator, 'room:join');
      expect(signedOut.messages.every((message) => message.t === 'ack')).toBe(true);
    },
  );

  it('allows authenticated spectators and token reconnects after runtime recreation', async () => {
    const h = roomHarness();
    h.wake();
    expect(await h.action(h.spectator, 'room:join')).toMatchObject({ ok: true, data: { isHost: false } });
    expect(h.spectator.snapshot.code).toBe('1234');
    expect(await h.action(h.host, 'room:join', {
      playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret',
    })).toMatchObject({ ok: true, data: { playerId: 'p0', isHost: true } });
  });
});

describe('self-service lobby seating', () => {
  async function setup() {
    const h = roomHarness(false);
    const created = await h.room.init({ code: '1234', creator: { name: 'Host', account: 'account-0' } });
    if (!created.ok) throw new Error(created.error);
    await h.action(h.host, 'room:join', created);
    return { h, created };
  }

  it('starts with only the creator and refuses to deal before five players sit down', async () => {
    const { h } = await setup();
    expect(h.document.members).toHaveLength(1);
    expect((await h.action(h.host, 'room:start')).error?.code).toBe('INVALID_PLAYER_COUNT');
    expect(h.document.meta.status).toBe('lobby');
  });

  it('allocates distinct seats atomically and caps simultaneous joins at ten players', async () => {
    const { h } = await setup();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const socket = new Socket({ account: `joiner-${i}`, isHost: false, isAdmin: false });
      return h.action(socket, 'room:claimSeat', { name: `Player ${i}`, avatarUrl: `https://example.com/${i}.png` });
    }));
    expect(results.filter((result) => result.ok)).toHaveLength(9);
    expect(results.filter((result) => result.error?.code === 'ROOM_FULL')).toHaveLength(3);
    expect(h.document.members).toHaveLength(10);
    expect(new Set(h.document.members.map((member) => member.id)).size).toBe(10);
    expect(h.document.members.map((member) => member.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(h.document.members.every((member) => member.claimed)).toBe(true);
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.host.game.players).toHaveLength(10);
  });

  it('keeps repeat clicks on the same seat and rejects a second seat for the same account', async () => {
    const { h, created } = await setup();
    const repeated = await h.action(h.host, 'room:claimSeat', { name: 'Host' });
    expect(repeated.data).toEqual({ playerId: created.playerId, playerToken: created.playerToken });
    const otherTab = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect((await h.action(otherTab, 'room:claimSeat', { name: 'Another' })).error?.code).toBe('ALREADY_SEATED');
    expect(h.document.members).toHaveLength(1);
  });

  it('reuses a released seat with a fresh token and the next account identity', async () => {
    const { h, created } = await setup();
    await h.action(h.host, 'room:releaseSeat');
    const result = await h.action(h.spectator, 'room:claimSeat', { name: 'Next', avatarUrl: 'https://example.com/next.png' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ playerId: created.playerId });
    expect((result.data as { playerToken: string }).playerToken).not.toBe(created.playerToken);
    expect(h.document.members).toHaveLength(1);
    expect(h.document.members[0]).toMatchObject({ name: 'Next', avatarUrl: 'https://example.com/next.png', claimed: true });
    h.wake();
    expect(await h.room.preview()).toMatchObject({ playerCount: 1 });
  });

  it('does not create placeholder seats when a sit request is invalid', async () => {
    const { h } = await setup();
    for (const name of ['', '  ', 'Host']) {
      expect((await h.action(h.spectator, 'room:claimSeat', { name })).ok).toBe(false);
      expect(h.document.members).toHaveLength(1);
      expect(h.document.meta.config.roster).toHaveLength(1);
    }
  });

  it('does not allocate new seats after the game starts', async () => {
    const h = roomHarness();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    const before = structuredClone(h.document);
    expect((await h.action(h.spectator, 'room:claimSeat', { name: 'Late' })).error?.code).toBe('WRONG_PHASE');
    expect(h.document).toEqual(before);
  });
});

describe('seat history across games', () => {
  it('follows accounts after standing and reclaiming a different player ID, including runtime recreation', async () => {
    const h = roomHarness();
    for (const socket of h.sockets.filter((socket) => socket !== h.spectator)) {
      const playerId = socket.deserializeAttachment().playerId!;
      await h.action(socket, 'room:join', {
        playerId, playerToken: `token-${playerId.slice(1)}`,
        ...(socket === h.host ? { hostToken: 'host-secret' } : {}),
      });
    }
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    const history = structuredClone(h.document.lastGameSeats!);
    await h.finish();
    await h.action(h.host, 'room:restart');
    const a = h.sockets[1]!;
    const b = h.sockets[2]!;
    await h.action(a, 'room:releaseSeat');
    await h.action(b, 'room:releaseSeat');
    expect((await h.action(a, 'room:claimSeat', { seatId: 'p3', name: 'Player 2' })).ok).toBe(true);
    expect((await h.action(b, 'room:claimSeat', { seatId: 'p2', name: 'Player 3' })).ok).toBe(true);
    expect(h.document.lastGameSeats).toEqual(history);
    h.wake();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    for (const player of h.host.game.players) {
      const account = h.document.accounts![player.id]!;
      expect(player.seat).not.toBe(history.byAccount[account]);
    }
    expect(h.document.accounts!.p3).toBe('account-2');
    expect(h.document.accounts!.p2).toBe('account-3');
    await h.finish();
    expect(h.archives.size).toBe(2);
  });

  it('also remembers the seat of an account that joined during the previous game', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    const oldSeat = h.host.game.players.find((player) => player.id === 'p2')!.seat;
    await h.action(h.sockets[1]!, 'room:releaseSeat');
    const late = new Socket({ account: 'late-account', isHost: false, isAdmin: false });
    h.sockets.push(late);
    await h.action(late, 'room:claimSeat', { seatId: 'p2', name: 'Late' });
    expect(h.document.lastGameSeats?.byAccount['late-account']).toBe(oldSeat);
    await h.finish();
    await h.action(h.host, 'room:restart');
    h.wake();
    await h.action(h.host, 'room:start');
    expect(late.game.players.find((player) => player.id === 'p2')!.seat).not.toBe(oldSeat);
  });

  it('migrates a game snapshot without explicit seat history before starting the next game', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    const previous = Object.fromEntries(h.host.game.players.map((player) => [player.id, player.seat]));
    delete h.document.lastGameSeats;
    h.wake();
    await h.finish();
    await h.action(h.host, 'room:restart');
    h.wake();
    await h.action(h.host, 'room:start');
    for (const player of h.host.game.players) expect(player.seat).not.toBe(previous[player.id]);
  });

  it('keeps the previous order and history intact if committing a new deal fails', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    await h.finish();
    await h.action(h.host, 'room:restart');
    const before = structuredClone(h.document);
    const history = before.lastGameSeats!;
    const pushes = h.host.messages.filter((message) => message.t === 'push').length;
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.action(h.host, 'room:start')).ok).toBe(false);
    expect(h.document).toEqual(before);
    expect(h.host.messages.filter((message) => message.t === 'push')).toHaveLength(pushes);
    h.wake();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    for (const player of h.host.game.players) expect(player.seat).not.toBe(history.byPlayer[player.id]);
  });
});

describe('non-blocking seating and role preferences', () => {
  function withAccounts() {
    const h = roomHarness();
    h.document.accounts = Object.fromEntries(h.sockets.filter((socket) => socket !== h.spectator)
      .map((socket) => [socket.deserializeAttachment().playerId!, socket.deserializeAttachment().account!]));
    return h;
  }

  it('starts when all previous seats conflict, allowing only the minimum one repeated seat', async () => {
    const h = withAccounts();
    h.document.lastGameSeats = {
      byPlayer: Object.fromEntries(Object.keys(h.document.accounts!).map((id) => [id, 0])),
      byAccount: Object.fromEntries(Object.values(h.document.accounts!).map((account) => [account, 0])),
    };
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.host.game.players).toHaveLength(5);
    expect(h.host.game.players.filter((player) => player.seat === 0)).toHaveLength(1);
    expect(h.document.meta.status).toBe('in_game');
  });

  it('ignores corrupt seat history and falls back when role preferences cannot be loaded', async () => {
    const h = withAccounts();
    h.document.lastGameSeats = { byPlayer: null, byAccount: 'corrupt' } as unknown as NonNullable<RoomDocument['lastGameSeats']>;
    vi.spyOn(h.persistence, 'getRoleWeights').mockRejectedValue(new Error('Preferences unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(validRoleAssignment(h.document.game!.config.roles, h.document.game!.players.map((player) => player.role))).toBe(true);
    expect(h.document.events.find(({ event }) => event.type === 'START_GAME')!.event).not.toHaveProperty('assignedRoles');
    await h.finish();
    expect(h.archives.size).toBe(1);
  });

  it('counts final roles once at game end, never on dealing or rerolling, and keeps preferences private', async () => {
    const h = withAccounts();
    const baseline = await h.persistence.getRoleWeights(Object.values(h.document.accounts!));
    expect((await h.action(h.host, 'room:start', { assignedRoles: Array(5).fill('Merlin') })).ok).toBe(true);
    await h.action(h.host, 'admin:auth');
    expect((await h.action(h.host, 'admin:rerollRoles')).ok).toBe(true);
    await h.persistence.getCards('account-0', Date.now());
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: h.host.game.roleRevision })).ok).toBe(true);
    expect(await h.persistence.getRoleWeights(Object.keys(baseline))).toEqual(baseline);
    expect(h.persistence.roleWeightGames.size).toBe(0);
    for (const text of ['assignedRoles', 'roleWeightAssignments', 'account-0', 'roleWeights']) {
      expect(JSON.stringify(h.spectator.messages)).not.toContain(text);
    }
    const finalRoles = Object.fromEntries(h.document.game!.players.map((player) => [h.document.accounts![player.id]!, player.role]));
    await h.finish();
    const settled = await h.persistence.getRoleWeights(Object.keys(finalRoles));
    for (const [account, role] of Object.entries(finalRoles)) {
      expect(settled[account]).toEqual(settledRoleWeights(undefined, role));
      expect(settled[account]![role]).toBe(75);
      expect(ALL_ROLES.filter((other) => other !== role).every((other) => settled[account]![other] === 125)).toBe(true);
    }
    expect(h.persistence.roleWeightGames.size).toBe(5);
    const replay = h.archives.get(h.host.game.gameId!)!;
    expect(replay.roleAssignments.map(({ playerId, role }) => [playerId, role]))
      .toEqual(h.document.game!.players.map((player) => [player.id, player.role]));
    await h.action(h.host, 'admin:previousPhase');
    const assassin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Assassin')!;
    const merlin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Merlin')!;
    expect((await h.action(assassin, 'game:assassinate', { targetPlayerId: merlin.deserializeAttachment().playerId })).ok).toBe(true);
    expect(await h.persistence.getRoleWeights(Object.keys(finalRoles))).toEqual(settled);
    h.wake();
    await h.action(h.spectator, 'room:join');
    expect(await h.persistence.getRoleWeights(Object.keys(finalRoles))).toEqual(settled);
  });

  it('settles the final account holding a seat, including a late joiner', async () => {
    const h = withAccounts();
    await h.action(h.host, 'room:start');
    await h.action(h.sockets[1]!, 'room:releaseSeat');
    const late = new Socket({ account: 'late-weight-account', isHost: false, isAdmin: false });
    h.sockets.push(late);
    await h.action(late, 'room:claimSeat', { seatId: 'p2', name: 'Late' });
    const finalRole = late.game.selfRole!;
    await h.finish();
    expect(h.persistence.roleWeights.has('account-2')).toBe(false);
    expect(h.persistence.roleWeights.get('late-weight-account')).toEqual(settledRoleWeights(undefined, finalRole));
  });

  it('does not count a game whose result failed to commit, then settles the retry only once', async () => {
    const h = withAccounts();
    await h.action(h.host, 'room:start');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:startAssassination');
    const assassin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Assassin')!;
    const merlin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Merlin')!;
    const target = { targetPlayerId: merlin.deserializeAttachment().playerId };
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.action(assassin, 'game:assassinate', target)).ok).toBe(false);
    expect(h.persistence.roleWeightGames.size).toBe(0);
    expect((await h.persistence.getRoleWeights(['account-0']))['account-0']).toEqual(normalizeRoleWeights(undefined));
    h.wake();
    expect((await h.action(assassin, 'game:assassinate', target)).ok).toBe(true);
    expect(h.persistence.roleWeightGames.size).toBe(5);
  });
});

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
    vi.spyOn(console, "error").mockImplementation(() => {});
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

describe('account reroll cards', () => {
  async function setup() {
    const h = roomHarness();
    h.host.serializeAttachment({ ...h.host.deserializeAttachment(), account: 'account-a' });
    await h.persistence.getCards('account-a', Date.now());
    const extra = new Socket({ account: "viewer-account", isHost: false, isAdmin: false });
    h.sockets.push(extra);
    await h.action(extra, 'room:claimSeat', { seatId: 'p1' });
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    return h;
  }

  it('atomically spends a card, redistributes private knowledge, and rejects a duplicate without spending', async () => {
    const h = await setup();
    const oldRole = h.host.game.selfRole;
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).ok).toBe(true);
    expect(h.host.game.selfRole).not.toBe(oldRole);
    expect(h.host.game.roleRevision).toBe(1);
    expect((await h.persistence.getCards('account-a')).cards).toBe(0);
    expect(h.spectator.game.selfRole).toBeNull();
    expect(JSON.stringify(h.spectator.messages)).not.toContain('account-a');
    await h.persistence.getCards('account-a', Date.now() + 86400000);
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).ok).toBe(false);
    expect((await h.persistence.getCards('account-a')).cards).toBe(1);
    h.wake();
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 1 })).ok).toBe(true);
    expect(h.host.game.roleRevision).toBe(2);
  });

  it('does not trust an account in the client payload and does not spend after acknowledgement', async () => {
    const h = await setup();
    expect((await h.action(h.spectator, 'game:useRerollCard', { roleRevision: 0, account: 'account-a', playerId: 'p0' })).error?.code).toBe('NOT_IN_ROOM');
    await h.action(h.host, 'game:ackRole', { roleRevision: 0 });
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).error?.code).toBe('WRONG_PHASE');
    expect((await h.persistence.getCards('account-a')).cards).toBe(1);
  });

  it('keeps the card and prior roles when persistence fails', async () => {
    const h = await setup();
    const before = structuredClone(h.document);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).ok).toBe(false);
    expect(h.document).toEqual(before);
    expect((await h.persistence.getCards('account-a')).cards).toBe(1);
  });

  it('counts completion once even after rollback and a second settlement of the same game', async () => {
    const h = await setup();
    await h.finish();
    expect((await h.persistence.getCards('account-a')).completedGames).toBe(1);
    expect((await h.action(h.host, 'admin:previousPhase')).ok).toBe(true);
    const assassin = h.sockets.find((s) => s !== h.spectator && s.game.selfRole === 'Assassin')!;
    const merlin = h.document.game!.players.find((p) => p.role === 'Merlin')!;
    expect((await h.action(assassin, 'game:assassinate', { targetPlayerId: merlin.id })).ok).toBe(true);
    expect((await h.persistence.getCards('account-a')).completedGames).toBe(1);
  });

  it('does not credit an account that releases its seat before settlement', async () => {
    const h = await setup();
    await h.action(h.host, 'room:releaseSeat');
    expect(h.document.gameAccounts).not.toHaveProperty('p0');
    expect((await h.persistence.getCards('account-a')).completedGames).toBe(0);
  });
});


describe('account device handoff', () => {
  it('restores the creator seat and host on a fresh browser and retires the previous device', async () => {
    const h = roomHarness(false);
    const created = await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    expect(created.ok).toBe(true);
    await h.action(h.host, 'room:join');
    const next = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    const joined = await h.action(next, 'room:join');
    expect(joined).toMatchObject({ ok: true, data: { playerId: h.document.members[0]!.id, isHost: true } });
    expect(h.host.close).toHaveBeenCalledWith(4001, expect.any(String));
    expect(h.host.deserializeAttachment()).toMatchObject({ playerId: undefined, isHost: false, isAdmin: false });
    expect((await h.action(h.host, 'room:join')).error?.code).toBe('RECONNECT');
    await h.room.webSocketClose(h.host);
    expect(h.document.members[0]).toMatchObject({ claimed: true, connected: true });
    expect((await h.action(next, 'room:rename', { name: 'Alice again' })).ok).toBe(true);
  });

  it('retains the lobby seat after disconnect and restores it after runtime recreation', async () => {
    const h = roomHarness(false);
    await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    await h.action(h.host, 'room:join');
    const id = h.document.members[0]!.id;
    await h.room.webSocketClose(h.host);
    expect(h.document.members[0]).toMatchObject({ id, claimed: true, connected: false });
    h.sockets.splice(0);
    h.wake();
    const next = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect(await h.action(next, 'room:join')).toMatchObject({ ok: true, data: { playerId: id, isHost: true } });
    await h.action(next, 'room:leave');
    expect((await h.action(next, 'room:join')).data).not.toHaveProperty('playerId');
  });

  it('does not let another account reuse seat or host tokens', async () => {
    const h = roomHarness(false);
    const created = await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    expect(await h.action(h.spectator, 'room:join', created)).toEqual({ ok: true, data: { isHost: false } });
    expect(h.document.accounts).toEqual({ [h.document.members[0]!.id]: 'account-0' });
  });

  it('does not publish a takeover when persistence fails', async () => {
    const h = roomHarness(false);
    await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    await h.action(h.host, 'room:join');
    await h.room.webSocketClose(h.host);
    h.room.addSocket(h.host);
    h.host.messages = [];
    h.save.mockRejectedValueOnce(new Error('save failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const next = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect((await h.action(next, 'room:join')).ok).toBe(false);
    expect(h.host.close).not.toHaveBeenCalledWith(4001, expect.any(String));
    expect(h.host.messages.some((message) => message.event === 'system:notice')).toBe(false);
  });
});

describe('server-controlled bots', () => {
  afterEach(() => vi.useRealTimers());

  it('restricts adding bots to the lobby host, protects their seats and supports removal', async () => {
    const h = roomHarness();
    expect((await h.action(h.spectator, 'room:addBot')).error?.code).toBe('NOT_HOST');
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    const bot = h.host.snapshot.members.find((m) => m.isBot)!;
    expect(bot).toMatchObject({ id: 'p1', claimed: true, connected: true });
    expect(h.document.sessions[bot.id]).toBeUndefined();
    expect((await h.action(h.spectator, 'room:claimSeat', { seatId: bot.id, name: 'Human' })).error?.code).toBe('SEAT_TAKEN');
    expect((await h.action(h.host, 'room:kick', { targetPlayerId: bot.id })).ok).toBe(true);
    expect(h.host.snapshot.members.find((m) => m.id === bot.id)).toMatchObject({ claimed: false });
    expect(h.document.members.find((m) => m.id === bot.id)?.isBot).toBeUndefined();
    await h.action(h.host, 'room:start');
    expect((await h.action(h.host, 'room:addBot')).error?.code).toBe('WRONG_PHASE');
  });

  it('acts immediately after resuming and honors timer pauses', async () => {
    vi.useFakeTimers();
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    await h.action(h.host, 'room:start');
    await h.action(h.host, 'net:ping');
    expect(h.document.game!.roleAcks).not.toContain('p1');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:setTimersPaused', { paused: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.document.game!.roleAcks).not.toContain('p1');
    await h.action(h.host, 'admin:setTimersPaused', { paused: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.document.game!.roleAcks).toContain('p1');
    // Clean up any subsequent bot action in this fake-clock room.
    await h.action(h.host, 'admin:setTimersPaused', { paused: true });
  });

  it('completes a game through automatic speeches, team votes and mission cards', async () => {
    vi.useFakeTimers();
    const h = roomHarness();
    // Make every occupied seat a bot to exercise consecutive automatic phases.
    for (const member of h.document.members) if (member.claimed) member.isBot = true;
    await h.action(h.host, 'room:start');
    for (let step = 0; step < 200 && h.document.game!.phase !== 'GameOver'; step++) {
      await vi.advanceTimersToNextTimerAsync();
      await h.room.drain();
    }
    expect(h.document.game!.phase).toBe('GameOver');
    expect(h.document.events.some(({ event }) => event.type === 'END_SPEECH')).toBe(true);
    expect(h.document.events.some(({ event }) => event.type === 'CAST_MISSION_CARD')).toBe(true);
    expect(h.document.archive?.replay.outcome).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restores pending bot actions and presence from persisted state', async () => {
    vi.useFakeTimers();
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    await h.action(h.host, 'room:start');
    vi.clearAllTimers(); // Simulate process exit before the queued action runs.
    h.wake();
    await h.action(h.spectator, 'room:join');
    expect(h.spectator.snapshot.members.find((m) => m.id === 'p1')?.connected).toBe(true);
    expect(h.document.game!.roleAcks).not.toContain('p1');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.document.game!.roleAcks).toContain('p1');
    vi.clearAllTimers();
  });
});

describe('committed per-viewer synchronization', () => {
  const latest = (socket: Socket) => socket.messages.filter((m) => m.event === 'view:sync').at(-1)!.payload as import('@/lib/socket/stateIntegrity').ViewSnapshot;
  async function connected() {
    const h = roomHarness();
    await h.action(h.host, 'room:join', { syncVersion: 1, playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    return h;
  }

  it('answers heartbeats and recovery from the committed cache while a write is blocked', async () => {
    const h = await connected(); const before = latest(h.host);
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const original = h.persistence.saveRoom.bind(h.persistence);
    h.save.mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    const change = h.action(h.host, 'room:rename', { name: 'Committed' });
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    try {
      const ping = await Promise.race([
        h.action(h.host, 'net:ping', { rtt: 20 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Ping waited for persistence')), 200)),
      ]);
      expect(ping.data).toEqual({ sync: { epoch: before.epoch, revision: before.revision, hash: before.hash } });
      await h.action(h.host, 'room:resync');
      expect(latest(h.host).view.room.members.find((m) => m.id === 'p0')!.name).not.toBe('Committed');
      expect(latest(h.host).recovery).toBe(true);
    } finally { release(); }
    await change;
    expect(latest(h.host).revision).toBeGreaterThan(before.revision);
    expect(latest(h.host).view.room.members.find((m) => m.id === 'p0')!.name).toBe('Committed');
    expect(h.save.mock.calls.at(-1)![4]?.changes.length).toBeGreaterThan(0);
  });

  it('publishes one atomic authorized view and advertises a missed update on a later heartbeat', async () => {
    const h = await connected();
    await h.action(h.spectator, 'room:join', { syncVersion: 1 });
    h.host.messages = []; h.spectator.messages = [];
    await h.action(h.host, 'room:start');
    const own = latest(h.host); const spectator = latest(h.spectator);
    expect(own.view.game?.selfRole).toBeTruthy();
    expect(spectator.view.game?.selfRole).toBeNull();
    expect(spectator.view.game?.players.every((p) => p.role === undefined)).toBe(true);
    expect(JSON.stringify(own)).not.toContain('host-secret');
    expect(JSON.stringify(own)).not.toContain('token-p0');
    expect(h.host.messages.filter((m) => m.t === 'push').map((m) => m.event)).toEqual(['view:sync']);
    h.host.messages = []; // Client loses the final update and nobody acts again.
    const ping = await h.action(h.host, 'net:ping');
    expect(ping.data).toEqual({ sync: { epoch: own.epoch, revision: own.revision, hash: own.hash } });
    await h.action(h.host, 'room:resync');
    expect(latest(h.host).view.game).toMatchObject({ selfRole: own.view.game!.selfRole });
  });

  it('does not expose speculative state or hashes after a failed commit', async () => {
    const h = await connected(); const before = latest(h.host);
    h.save.mockRejectedValueOnce(new Error('Failed write'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.action(h.host, 'room:rename', { name: 'Speculative' })).ok).toBe(false);
    expect(latest(h.host)).toEqual(before);
    expect((await h.action(h.host, 'net:ping')).ok).toBe(false);
    expect((await h.action(h.host, 'room:resync')).ok).toBe(false);
  });

  it('keeps the view revision increasing on referee rollback and uses a fresh epoch after reload', async () => {
    const h = await connected();
    await h.action(h.host, 'room:start');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:startAssassination');
    const advanced = latest(h.host);
    await h.action(h.host, 'admin:previousPhase');
    const rewound = latest(h.host);
    expect(rewound.revision).toBeGreaterThan(advanced.revision);
    expect(rewound.view.game?.phase).toBe('TeamBuilding');
    h.wake();
    await h.action(h.host, 'room:join', { syncVersion: 1 });
    expect(latest(h.host).epoch).not.toBe(rewound.epoch);
  });

  it('never reads or writes PostgreSQL for a heartbeat on an unloaded room', async () => {
    const h = roomHarness(); const load = vi.spyOn(h.persistence, 'loadRoom');
    await h.action(h.host, 'net:ping');
    expect(load).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });
});

describe('background checkpoint lifecycle', () => {
  it('verifies pending changes after the interval without holding the room queue', async () => {
    vi.useFakeTimers();
    try {
      const h = roomHarness();
      let release!: () => void;
      const checkpoint = vi.fn(() => new Promise<void>((done) => { release = done; }));
      const persistence = h.persistence as import('./persistence').Persistence;
      persistence.checkpointRoom = checkpoint;
      await h.action(h.host, 'room:rename', { name: 'First' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(checkpoint).toHaveBeenCalledOnce();
      expect((await h.action(h.host, 'net:ping')).ok).toBe(true);
      expect((await h.action(h.host, 'room:rename', { name: 'Second' })).ok).toBe(true);
      release();
      await Promise.resolve(); await Promise.resolve();
      checkpoint.mockResolvedValue(undefined);
      await h.room.drain();
      expect(checkpoint).toHaveBeenLastCalledWith('1234', expect.any(Number), expect.objectContaining({ members: expect.arrayContaining([expect.objectContaining({ name: 'Second' })]) }));
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });

  it('quarantines a room after verification finds corrupt history', async () => {
    const { JournalIntegrityError } = await import('./room-journal');
    const h = roomHarness();
    (h.persistence as import('./persistence').Persistence).checkpointRoom = vi.fn().mockRejectedValue(new JournalIntegrityError('Room journal hash mismatch'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.action(h.host, 'room:rename', { name: 'Saved' });
    await h.room.drain();
    const writes = h.save.mock.calls.length;
    expect((await h.action(h.host, 'room:rename', { name: 'Refused' })).ok).toBe(false);
    expect((await h.action(h.host, 'net:ping')).ok).toBe(false);
    expect(h.save).toHaveBeenCalledTimes(writes);
    expect(h.document.members[0]!.name).toBe('Saved');
  });
});
