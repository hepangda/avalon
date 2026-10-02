import {
buildRoleSet,
createGame,
createRng,
projectStateForViewer,
reduce,
type ClientGameState,
type EngineContext,
type GameEvent
} from "@/lib/engine";
import { weightedRoleAssignment } from '@/lib/engine/roleWeights';
import { fallbackSeatName } from "@/lib/game/names";
import {
type RoleNotesDocument
} from "@/lib/game/roleNotes";
import type { WireRequest } from "@/lib/socket/protocol";
import { resolveRoomConfig } from '@/lib/socket/roomConfig';
import { type HeartbeatState } from '@/lib/socket/stateIntegrity';
import type {
Ack,
RoomConfig,
RoomMember,
RoomStatus,
} from "@/lib/socket/types";
import { BOT_DELAY_MS,botAction } from "./bots";
import {
DEFAULT_ATTACHMENT,
type RoomSocket,
type SocketAttachment,
} from "./env";
import { makePlayerId,makeSessionToken } from "./ids";
import type { Persistence,RoomDocument } from "./persistence";
import { buildReplayFromEvents } from "./replay-builder";
import { RoomCheckpoints } from './room-checkpoints';
import { dispatchRoomEvent,type RoomCommandHandlers } from './room-events';
import { diffState,documentHash } from './room-journal';
import { RoomMembership } from './room-membership';
import { syncRoleNotes } from './room-notes';
import { RefereeCommands } from './room-referee';
import { fail,ok } from './room-result';
import { RoomState } from './room-state';
import { RoomViews } from './room-views';
import { normalizeSeatHistory,randomSeatOrder,recordSeats } from './seating';

import {
activePlayers,
mergeConfig,
sanitizeName,
sanitizeRoster
} from "./room-helpers";

/** A viewer id guaranteed not to match any seat → projects the spectator view. */
const SPECTATOR_VIEWER = "__spectator__";
/** One serial command queue per room; PostgreSQL owns the durable state. */
export class Room {
  private readonly state = new RoomState();
  private readonly views: RoomViews;
  private readonly membership: RoomMembership;
  private spendAccount: string | undefined;
  private version = 0;
  private loaded = false;
  private committedDocument: RoomDocument | null = null;
  private committedHash = '';
  private integrityFailure: Error | null = null;
  private latencies = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private sockets = new Set<RoomSocket>();
  private reconnectOnly = new WeakSet<RoomSocket>();
  private outgoing: Array<() => void> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly checkpoints: RoomCheckpoints;
  private readonly referee: RefereeCommands;
  private readonly commands: RoomCommandHandlers;
  lastUsed = Date.now();

  constructor(
    readonly code: string,
    private readonly persistence: Persistence,
  ) {
    const room = this;
    this.views = new RoomViews({
      state: this.state, sockets: this.sockets, latencies: this.latencies, reconnectOnly: this.reconnectOnly,
      attach: (ws) => this.attach(ws),
    });
    this.membership = new RoomMembership(this.state, {
      latencies: this.latencies,
      sockets: this.sockets,
      attach: (ws) => this.attach(ws),
      setAttach: (ws, patch) => this.setAttach(ws, patch),
      send: (ws, event, payload) => this.send(ws, event, payload),
      wsForPlayer: (id) => this.wsForPlayer(id),
      applyEvent: (event) => this.applyEvent(event),
      broadcastRoom: () => this.broadcastRoom(),
      syncOne: (id) => this.syncOne(id),
      syncSpectator: (ws) => this.syncSpectator(ws),
      negotiateView: (ws) => { this.views.enable(ws); },
      retireAfterCommit: (ws) => this.outgoing!.push(() => {
        this.reconnectOnly.add(ws);
        ws.close(4001, 'Room opened on another device');
      }),
    });
    this.checkpoints = new RoomCheckpoints({
      code, persistence,
      get integrityFailure() { return room.integrityFailure; },
      get version() { return room.version; },
      get loaded() { return room.loaded; },
      get committedDocument() { return room.committedDocument; },
      quarantine: (error) => {
        this.integrityFailure = error;
        if (this.botTimer) clearTimeout(this.botTimer);
        this.botTimer = undefined;
        for (const ws of this.sockets) {
          this.reconnectOnly.add(ws);
          ws.close(1012, 'Room recovery verification failed');
        }
      },
    });
    this.referee = new RefereeCommands({
      get meta() { return room.state.meta; },
      get game() { return room.state.game; },
      get members() { return room.state.members; },
      attach: (ws) => this.attach(ws),
      setAttach: (ws, patch) => this.setAttach(ws, patch),
      pushAdminLog: (key, params) => this.pushAdminLog(key, params),
      releaseSeat: (id) => this.membership.releaseSeat(id),
      wsForPlayer: (id) => this.wsForPlayer(id),
      send: (ws, event, payload) => this.send(ws, event, payload),
      applyEvent: (event) => this.applyEvent(event),
      broadcastRoom: () => this.broadcastRoom(),
      syncSpectator: (ws) => this.syncSpectator(ws),
    });
    this.commands = {
      membership: this.membership, referee: this.referee,
      handleNotesSync: (ws, payload) => this.handleNotesSync(ws, payload),
      handleRestart: (ws) => this.handleRestart(ws),
      handleStart: (ws) => this.handleStart(ws),
      handleUseRerollCard: (ws, payload) => this.handleUseRerollCard(ws, payload),
      handlePing: (ws, payload) => this.handlePing(ws, payload),
      gameAction: (ws, build) => this.gameAction(ws, build),
    };
  }

  get idle(): boolean {
    return this.sockets.size === 0 && this.pending === 0 && !this.botTimer && this.checkpoints.idle;
  }

  addSocket(ws: RoomSocket): void {
    if (!this.attach(ws).account) {
      ws.close(1008, "Sign in to enter a room");
      return;
    }
    this.sockets.add(ws);
    this.lastUsed = Date.now();
  }

  async drain(): Promise<void> {
    await this.queue;
    await this.checkpoints.drain();
  }

  private document(): RoomDocument {
    return {
      schemaVersion: 1,
      meta: this.state.meta!,
      members: [...this.state.members.values()].map(
        ({ latency: _latency, ...member }) => member,
      ),
      game: this.state.game,
      eventSeq: this.state.eventSeq,
      events: this.state.events,
      sessions: this.state.sessions,
      notes: this.state.notes,
      archive: this.state.archive,
      accounts: this.state.accounts,
      gameAccounts: this.state.gameAccounts,
      lastGameSeats: this.state.lastGameSeats,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const record = await this.persistence.loadRoom(this.code);
    if (record) {
      const d = record.document;
      this.committedDocument = structuredClone(d);
      this.committedHash = documentHash(d);
      this.checkpoints.checkpointVersion = record.version;
      if (d.schemaVersion !== 1 || d.meta.code !== this.code)
        throw new Error("Unsupported room snapshot");
      this.state.meta = d.meta;
      this.state.members = new Map(d.members.map((m) => [m.id, m]));
      this.state.game = d.game;
      this.state.eventSeq = d.eventSeq;
      this.state.events = d.events;
      this.state.sessions = d.sessions;
      this.state.notes = d.notes;
      this.state.archive = d.archive;
      this.state.accounts = d.accounts ?? {};
      this.state.gameAccounts = d.gameAccounts ?? {};
      // Existing snapshots predate explicit history. Retain their game order,
      // or the surviving lobby order when the previous game has been cleared.
      this.state.lastGameSeats = normalizeSeatHistory(d.lastGameSeats ?? recordSeats(
        d.game?.players ?? d.members.filter((member) => member.claimed && !member.isSpectator),
        this.state.accounts,
      ));
      this.version = record.version;
      // TCP connections cannot survive a process restart; seat tokens can.
      for (const member of this.state.members.values()) {
        member.connected = !!member.isBot || !!this.wsForPlayer(member.id);
        delete member.latency;
      }
    } else {
      this.committedDocument = null;
      this.committedHash = '';
      this.state.meta = null;
      this.state.members.clear();
      this.state.game = null;
      this.state.eventSeq = 0;
      this.state.events = [];
      this.state.sessions = {};
      this.state.notes = {};
      this.state.archive = null;
      this.state.accounts = {};
      this.state.gameAccounts = {};
      this.state.lastGameSeats = { byPlayer: {}, byAccount: {} };
      this.version = 0;
    }
    this.loaded = true;
  }

  /** No public push or successful acknowledgement escapes before COMMIT. */
  private run<T>(fn: () => Promise<T> | T, readOnly = false): Promise<T> {
    this.pending++;
    const operation = this.queue.then(async () => {
      this.lastUsed = Date.now();
      const attachments = new Map(
        [...this.sockets].map((ws) => [ws, structuredClone(this.attach(ws))]),
      );
      try {
        if (this.integrityFailure) throw this.integrityFailure;
        await this.ensureLoaded();
        this.outgoing = [];
        this.views.dirty = false;
        this.spendAccount = undefined;
        const result = await fn();
        if (this.integrityFailure) throw this.integrityFailure;
        if (this.state.meta && !readOnly) {
          const document = this.document();
          const changes = diffState(this.committedDocument, document);
          if (changes.length) {
            const hash = documentHash(document);
            this.version = await this.persistence.saveRoom(
              this.code, this.version, document, this.spendAccount,
              this.committedDocument ? { format: 1, baseHash: this.committedHash, hash, changes } : undefined,
            );
            this.committedDocument = structuredClone(document);
            this.committedHash = hash;
          }
        }
        if (this.integrityFailure) throw this.integrityFailure;
        const outgoing = this.outgoing;
        this.outgoing = null;
        this.views.commitAttachments();
        for (const send of outgoing) send();
        if (this.views.dirty) this.views.publish();
        if (!readOnly) this.checkpoints.schedule();
        this.scheduleBots();
        return result;
      } catch (error) {
        // A lost COMMIT response is ambiguous: always reload PostgreSQL next time.
        if (this.botTimer) clearTimeout(this.botTimer);
        this.botTimer = undefined;
        this.loaded = false;
        this.views.invalidate();
        this.outgoing = null;
        for (const [ws, attachment] of attachments)
          ws.serializeAttachment(attachment);
        // Make every viewer rejoin and obtain the committed state, never a speculative state.
        for (const ws of this.sockets) {
          this.reconnectOnly.add(ws);
          ws.close(1012, "Reload room state");
        }
        throw error;
      } finally {
        this.pending--;
        this.lastUsed = Date.now();
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  /** Schedule from committed action timestamps, so pings cannot postpone bots. */
  private scheduleBots(): void {
    if (this.integrityFailure) return;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = undefined;
    const pending = this.state.game?.actionTimers?.filter((timer) =>
      timer.pausedAt === undefined && this.state.members.get(timer.playerId)?.isBot && this.state.members.get(timer.playerId)?.claimed,
    ) ?? [];
    if (!pending.length) return;
    const due = Math.min(...pending.map((timer) => timer.startedAt + BOT_DELAY_MS));
    this.botTimer = setTimeout(() => {
      this.botTimer = undefined;
      void this.run(async () => {
        // Re-read after entering the serial queue: a referee may have changed phase.
        const ready = this.state.game?.actionTimers?.filter((timer) => timer.pausedAt === undefined &&
          this.state.members.get(timer.playerId)?.isBot && this.state.members.get(timer.playerId)?.claimed &&
          timer.startedAt + BOT_DELAY_MS <= Date.now()) ?? [];
        for (const timer of ready) {
          if (!this.state.game?.actionTimers?.some((current) => current.playerId === timer.playerId &&
            current.action === timer.action && current.startedAt === timer.startedAt)) continue;
          const result = await this.applyEvent(botAction(this.state.game, timer, `${this.state.meta!.seed}:bot:${this.state.eventSeq + 1}:${timer.playerId}`));
          if (!result.ok) throw new Error(`Bot action failed: ${result.error?.code}`);
        }
      }).catch((error) => console.error('[room] bot action error', error));
    }, Math.max(0, due - Date.now()));
    this.botTimer.unref?.();
  }

  // ---------------------------------------------------------------------------
  // Room API
  // ---------------------------------------------------------------------------

  /** Create this room (idempotent). Returns the host token, or ok:false if the
   *  room already exists (code collision → caller retries with a new code). */
  async init(input: {
    code: string;
    roster?: string[];
    config?: Partial<RoomConfig>;
    creator: { name: string; avatarUrl?: string; account?: string };
  }): Promise<
    | { ok: true; hostToken: string; playerId: string; playerToken: string }
    | { ok: false; error: "ROOM_EXISTS" | "INVALID_CREATOR" }
  > {
    return this.run(async () => {
      if (this.state.meta) return { ok: false, error: "ROOM_EXISTS" };
      const hostToken = makePlayerId();
      const roster = sanitizeRoster(input.roster ?? []);
      const creatorName = sanitizeName(input.creator.name);
      if (!creatorName) return { ok: false, error: "INVALID_CREATOR" };
      if (roster.length === 0) roster.push(fallbackSeatName(0));
      const config = mergeConfig(input.config, roster);
      const seats: RoomMember[] = roster.map((name, i) => ({
        id: makePlayerId(),
        name,
        seat: i,
        isSpectator: false,
        connected: false,
        claimed: false,
      }));
      const creatorSeat = seats[0]!;
      creatorSeat.name = creatorName;
      if (input.creator.avatarUrl)
        creatorSeat.avatarUrl = input.creator.avatarUrl;
      creatorSeat.claimed = true;
      const playerToken = makeSessionToken();
      for (const s of seats) this.membership.persistPlayer(s);
      this.membership.persistPlayerSession(creatorSeat.id, playerToken);
      if (input.creator.account) this.state.accounts[creatorSeat.id] = input.creator.account;
      this.state.meta = {
        code: input.code,
        hostToken,
        hostAccount: input.creator.account,
        status: "lobby",
        config,
        gameId: null,
        seed: null,
      };
      this.state.members = new Map(seats.map((s) => [s.id, s]));
      return { ok: true, hostToken, playerId: creatorSeat.id, playerToken };
    });
  }

  /** Public, non-sensitive room preview for the join page. */
  async preview(): Promise<{
    code: string;
    status: RoomStatus;
    playerCount: number;
    maxPlayers: number;
    allowSpectators: boolean;
    allowMidJoin: boolean;
  } | null> {
    return this.run(() => {
      if (!this.state.meta) return null;
      const seated = activePlayers(this.state.members);
      return {
        code: this.state.meta.code,
        status: this.state.meta.status,
        playerCount: seated.filter((member) => member.claimed).length,
        maxPlayers: this.state.meta.config.maxPlayers,
        allowSpectators: this.state.meta.config.allowSpectators,
        allowMidJoin: this.state.meta.config.allowMidJoin,
      };
    }, true);
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle
  // ---------------------------------------------------------------------------

  async webSocketMessage(
    ws: RoomSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;
    let req: WireRequest;
    try {
      req = JSON.parse(message) as WireRequest;
    } catch {
      return;
    }
    if (req?.t !== "req" || typeof req.id !== "string") return;
    // Enforce the account requirement even if a caller bypasses the upgrade path.
    if (!this.attach(ws).account) {
      this.sendAck(ws, req.id, fail("AUTH_REQUIRED", "Sign in to enter a room"));
      ws.close(1008, "Sign in to enter a room");
      return;
    }
    // Transport telemetry only sees cached committed views, even during an awaited COMMIT.
    if (req.event === 'net:ping') {
      this.lastUsed = Date.now();
      if (this.integrityFailure || this.reconnectOnly.has(ws)) {
        this.sendAck(ws, req.id, fail('RECONNECT', 'Reconnect to reload room state'));
        return;
      }
      const committed = this.views.get(ws);
      const sync = committed ? { epoch: committed.epoch, revision: committed.revision, hash: committed.hash } : null;
      this.sendAck(ws, req.id, ok<HeartbeatState>({ sync }));
      this.handlePing(ws, req.payload);
      return;
    }
    if (req.event === 'room:resync') {
      const committed = this.views.get(ws);
      if (this.integrityFailure || this.reconnectOnly.has(ws) || !committed) this.sendAck(ws, req.id, fail('NOT_JOINED', 'Join the room first'));
      else {
        this.views.sendView(ws, committed, true);
        this.sendAck(ws, req.id, ok());
      }
      return;
    }
    try {
      const res = await this.run(async () => {
        if (this.reconnectOnly.has(ws))
          return fail("RECONNECT", "Reconnect to reload room state");
        return await dispatchRoomEvent(this.commands, ws, req.event, req.payload);
      }, req.event === 'notes:sync' && (req.payload as { update?: unknown } | null)?.update === undefined);
      this.sendAck(ws, req.id, res);
    } catch (e) {
      console.error("[room] handler error", e);
      this.sendAck(ws, req.id, fail("INTERNAL", "Internal error"));
    }
  }

  async webSocketClose(ws: RoomSocket): Promise<void> {
    if (!this.sockets.delete(ws) || this.reconnectOnly.has(ws)) return;
    await this.run(async () => {
      await this.membership.handleDisconnect(ws);
    });
  }

  webSocketError(_ws: RoomSocket, error: unknown): void {
    console.error("[room] ws error", error);
  }

  // ---------------------------------------------------------------------------
  // Room handlers
  // ---------------------------------------------------------------------------

  private handleNotesSync(ws: RoomSocket, payload: unknown): Ack<RoleNotesDocument> {
    const playerId = this.attach(ws).playerId;
    return syncRoleNotes({ playerId, game: this.state.game, gameId: this.state.meta?.gameId,
      notes: this.state.notes, members: this.state.members, currentConnection: !!playerId && this.wsForPlayer(playerId) === ws }, payload);
  }

  private async handleRestart(ws: RoomSocket): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "finished" || this.state.game?.phase !== "GameOver") {
      return fail(
        "WRONG_PHASE",
        "The game must finish before returning to the lobby",
      );
    }
    this.state.events = [];
    this.state.notes = {};
    this.state.archive = null;
    this.state.meta.status = "lobby";
    this.state.meta.gameId = null;
    this.state.meta.seed = null;
    this.state.eventSeq = 0;
    this.state.game = null;
    for (const socket of [...this.sockets])
      this.setAttach(socket, { isAdmin: false });
    this.broadcastRoom();
    return ok();
  }

  private async handleStart(ws: RoomSocket): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Already started");

    const seats = activePlayers(this.state.members);
    const participants = seats.filter((member) => member.claimed);
    if (participants.length < 5 || participants.length > 10) {
      return fail("INVALID_PLAYER_COUNT", "Need 5–10 seated players to deal");
    }
    this.state.meta.config = resolveRoomConfig(this.state.meta.config, participants.length);
    try {
      buildRoleSet(participants.length, this.state.meta.config.options);
    } catch (e) {
      return fail("INVALID_ROLE_SET", (e as Error).message);
    }

    const seed = `${this.state.meta.code}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let seated;
    try {
      seated = randomSeatOrder(participants, (member) => {
        const account = this.state.accounts[member.id];
        return (account ? this.state.lastGameSeats?.byAccount?.[account] : undefined)
          ?? this.state.lastGameSeats?.byPlayer?.[member.id];
      }, createRng(`${seed}:seats`));
    } catch {
      seated = createRng(`${seed}:seats:fallback`).shuffle(participants);
    }
    const created = createGame({
      hostId: seated[0]!.id,
      players: seated.map((m) => ({ id: m.id, name: m.name })),
      options: this.state.meta.config.options,
      seed,
    });
    if (!created.ok) return fail(created.error.code, created.error.message);

    // Old rooms and released seats may still contain placeholders. Deal only to
    // actual participants, retaining their IDs/tokens in the randomized order.
    const roster = seated.map((member, index) => this.state.meta!.config.roster[member.seat] ?? fallbackSeatName(index));
    for (const member of seats) {
      if (member.claimed) continue;
      this.membership.deletePlayer(member.id);
      delete this.state.accounts[member.id];
      delete this.state.notes[member.id];
    }
    seated.forEach((member, index) => { member.seat = index; });
    this.state.meta.config.roster = roster;
    this.state.lastGameSeats = recordSeats(seated, this.state.accounts);

    const gameId = makePlayerId();
    this.state.gameAccounts = Object.fromEntries(seated.filter((m) => m.claimed && this.state.accounts[m.id]).map((m) => [m.id, this.state.accounts[m.id]!]));
    this.state.events = []; // fresh log for the new game
    this.state.notes = {};
    this.state.game = created.state;
    this.state.meta.gameId = gameId;
    this.state.meta.seed = seed;
    this.state.eventSeq = 0;
    this.state.meta.status = "in_game";

    const res = await this.applyEvent({
      type: "START_GAME",
      by: seated[0]!.id,
      flowVersion: 5,
    });
    if (!res.ok) return res;
    for (const m of seated) if (m.claimed) this.sendPrivateReveal(m.id);
    this.broadcastRoom();
    return ok();
  }

  private async handleUseRerollCard(ws: RoomSocket, payload: unknown): Promise<Ack> {
    const { playerId, account } = this.attach(ws);
    if (!account) return fail('AUTH_REQUIRED', 'Sign in to use reroll cards');
    if (!playerId || this.state.accounts[playerId] !== account || !this.state.members.get(playerId)?.claimed)
      return fail('NOT_IN_ROOM', 'Claim a seat first');
    if (!(await this.persistence.getCards(account)).cards)
      return fail('NO_REROLL_CARDS', 'No reroll cards remaining');
    const roleRevision = (payload as { roleRevision?: unknown } | null)?.roleRevision;
    if (!Number.isInteger(roleRevision)) return fail('INVALID', 'Invalid role revision');
    const result = await this.applyEvent({ type: 'USE_REROLL_CARD', by: playerId, roleRevision: roleRevision as number });
    if (result.ok) this.spendAccount = account;
    return result;
  }

  private async gameAction(
    ws: RoomSocket,
    build: (pid: string) => GameEvent,
  ): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const pid = this.attach(ws).playerId;
    if (!pid) return fail("NOT_IN_ROOM", "No player id");
    return this.applyEvent(build(pid));
  }

  private handlePing(ws: RoomSocket, payload: unknown): Ack {
    const pid = this.views.attachment(ws)?.playerId;
    const rtt = (payload as { rtt?: unknown } | null)?.rtt;
    if (pid && typeof rtt === 'number' && Number.isFinite(rtt)) {
      const latency = Math.max(0, Math.min(9999, Math.round(rtt)));
      if (this.latencies.get(pid) !== latency) {
        this.latencies.set(pid, latency);
        for (const socket of this.sockets)
          if (!this.reconnectOnly.has(socket)) this.sendImmediate(socket, 'net:latency', { playerId: pid, latency });
      }
    }
    return ok();
  }

  // ---------------------------------------------------------------------------
  // Engine application + projection + broadcast
  // ---------------------------------------------------------------------------

  private async applyEvent(event: GameEvent): Promise<Ack> {
    if (!this.state.game || !this.state.meta || !this.state.meta.seed)
      return fail("NO_GAME", "No game in progress");
    const prevState = this.state.game;
    const seq = this.state.eventSeq + 1;
    const ctx: EngineContext = {
      now: Date.now(),
      rng: createRng(`${this.state.meta.seed}:${seq}`),
    };
    if (event.type === 'START_GAME' || event.type === 'REROLL_ROLES' || event.type === 'USE_REROLL_CARD') {
      try {
        const weights = await this.persistence.getRoleWeights(Object.values(this.state.accounts));
        const byPlayer = Object.fromEntries(this.state.game.players.map((player) => [player.id, weights[this.state.accounts[player.id]!]]));
        const requesterId = event.type === 'USE_REROLL_CARD' ? event.by : undefined;
        const requester = this.state.game.players.find((player) => player.id === requesterId);
        const assignedRoles = weightedRoleAssignment(
          this.state.game.players, this.state.game.config.roles, byPlayer, createRng(`${this.state.meta.seed}:${seq}:roles`),
          requester ? { playerId: requester.id, role: requester.role } : undefined,
        );
        if (assignedRoles) event = { ...event, assignedRoles };
      } catch {
        // Ordinary seeded dealing remains available even when preferences cannot be read.
        console.warn('[roles] Role preferences unavailable; using ordinary random assignment');
      }
    }
    const result = reduce(prevState, event, ctx);
    if (!result.ok) return fail(result.error.code, result.error.message);

    if (result.state.roleRevision !== prevState.roleRevision) this.state.notes = {};
    this.state.game = result.state;
    this.state.eventSeq = seq;
    this.state.events.push({ seq, event, createdAt: ctx.now });

    for (const effect of result.effects) {
      if (effect.kind === "PRIVATE_LADY") {
        const w = this.wsForPlayer(effect.holderId);
        if (w)
          this.send(w, "private:lady", {
            targetId: effect.targetId,
            loyalty: effect.loyalty,
          });
      } else if (effect.kind === "PERSIST_CHECKPOINT") {
        if (effect.checkpoint === "game_started") this.setStatus("in_game");
        else if (effect.checkpoint === "game_over") {
          this.setStatus("finished");
          this.prepareReplayArchive();
        }
      }
    }

    if (event.type === "PREVIOUS_PHASE") this.setStatus("in_game");
    this.broadcastState();
    if (event.type === "REROLL_ROLES" || event.type === "USE_REROLL_CARD") {
      for (const member of this.state.members.values()) {
        if (member.claimed && !member.isSpectator)
          this.sendPrivateReveal(member.id);
      }
    }
    return ok();
  }

  /** The archive is committed in the same PostgreSQL transaction as GameOver. */
  private prepareReplayArchive(): void {
    if (!this.state.meta?.gameId || !this.state.meta.seed)
      throw new Error("No game to archive");
    const seated = activePlayers(this.state.members).map((m) => ({
      id: m.id,
      name: m.name,
    }));
    const replay = buildReplayFromEvents(
      this.state.meta.gameId,
      this.state.meta.seed,
      this.state.meta.config.options,
      seated,
      this.state.events,
    );
    if (!replay?.outcome)
      throw new Error("Cannot archive an incomplete replay");
    this.state.archive = {
      replay, revision: this.state.eventSeq, rewardAccounts: [...new Set(Object.values(this.state.gameAccounts))],
      roleWeightAssignments: Object.fromEntries(this.state.game!.players.flatMap((player) => {
        const account = this.state.members.get(player.id)?.claimed ? this.state.accounts[player.id] : undefined;
        return account ? [[account, player.role]] : [];
      })),
    };
  }

  private broadcastState(): void {
    if (!this.state.game) return;
    this.views.dirty = true;
    let spectatorView: ClientGameState | null = null;
    for (const w of [...this.sockets]) {
      if (this.views.isReliable(w)) continue;
      const pid = this.attach(w).playerId;
      if (pid && this.state.members.has(pid)) {
        this.send(w, "state:sync", this.views.project(pid));
      } else {
        if (!spectatorView) spectatorView = this.views.project(SPECTATOR_VIEWER);
        this.send(w, "state:sync", spectatorView);
      }
    }
  }

  private broadcastRoom(): void {
    if (!this.state.meta) return;
    this.views.dirty = true;
    const snap = this.views.roomSnapshot();
    for (const w of this.sockets) if (!this.views.isReliable(w)) this.send(w, "room:snapshot", snap);
  }

  private sendPrivateReveal(playerId: string): void {
    if (!this.state.game) return;
    this.views.dirty = true;
    const socket = this.wsForPlayer(playerId);
    if (socket && this.views.isReliable(socket)) return;
    const view = projectStateForViewer(this.state.game, playerId);
    if (view.selfRole) {
      const w = this.wsForPlayer(playerId);
      if (w)
        this.send(w, "private:reveal", {
          selfRole: view.selfRole,
          knownPlayers: view.knownPlayers,
        });
    }
  }

  private syncOne(playerId: string): void {
    if (!this.state.game) return;
    this.views.dirty = true;
    const w = this.wsForPlayer(playerId);
    if (w && !this.views.isReliable(w)) this.send(w, "state:sync", this.views.project(playerId));
  }

  private syncSpectator(ws: RoomSocket): void {
    if (!this.state.game) return;
    this.views.dirty = true;
    if (!this.views.isReliable(ws)) this.send(ws, "state:sync", this.views.project(SPECTATOR_VIEWER));
  }

  private pushAdminLog(
    key: string,
    params: Record<string, string | number>,
  ): void {
    if (!this.state.game) return;
    this.state.game.logSeq += 1;
    this.state.game.logs.push({
      seq: this.state.game.logSeq,
      roundIndex: this.state.game.roundIndex,
      at: Date.now(),
      channel: "public",
      key,
      params,
      style: "admin",
    });
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // RoomSocket / attachment helpers (replace socket.data + socketByPlayer)
  // ---------------------------------------------------------------------------

  private attach(ws: RoomSocket): SocketAttachment {
    return (
      (ws.deserializeAttachment() as SocketAttachment | null) ?? {
        ...DEFAULT_ATTACHMENT,
      }
    );
  }

  private setAttach(ws: RoomSocket, patch: Partial<SocketAttachment>): void {
    ws.serializeAttachment({ ...this.attach(ws), ...patch });
    this.views.dirty = true;
  }

  private wsForPlayer(pid: string): RoomSocket | undefined {
    for (const w of [...this.sockets]) {
      if (this.attach(w).playerId === pid) return w;
    }
    return undefined;
  }

  private send(ws: RoomSocket, event: string, payload: unknown): void {
    if (['state:sync', 'room:snapshot', 'private:reveal', 'private:lady'].includes(event)) {
      this.views.dirty = true;
      if (this.views.isReliable(ws)) return;
    }
    const message = JSON.stringify({ t: "push", event, payload });
    const send = () => {
      try {
        ws.send(message);
      } catch {
        /* closed socket */
      }
    };
    if (this.outgoing) this.outgoing.push(send);
    else send();
  }

  private sendImmediate(ws: RoomSocket, event: string, payload: unknown): void {
    try { ws.send(JSON.stringify({ t: 'push', event, payload })); } catch { /* closed socket */ }
  }

  private sendAck(ws: RoomSocket, id: string, res: Ack<unknown>): void {
    try {
      ws.send(JSON.stringify({ t: "ack", id, res }));
    } catch {
      /* socket closing; drop the ack */
    }
  }

  // ---------------------------------------------------------------------------
  // In-memory bookkeeping, captured atomically by run().
  // ---------------------------------------------------------------------------

  private setStatus(status: RoomStatus): void {
    if (this.state.meta) this.state.meta.status = status;
  }
}
