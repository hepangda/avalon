import { randomUUID } from 'node:crypto';
import { CHECKPOINT_EVERY, CHECKPOINT_INTERVAL_MS, JournalIntegrityError, diffState, documentHash } from './room-journal';
import { viewContent, type HeartbeatState, type ViewSnapshot, type RoomView } from '@/lib/socket/stateIntegrity';
import { resolveRoomConfig } from '@/lib/socket/roomConfig';
import {
  buildRoleSet,
  createGame,
  createRng,
  leaderId,
  projectStateForViewer,
  reduce,
  type ClientGameState,
  type EngineContext,
  type GameEvent,
  type GameState,
} from "@/lib/engine";
import { botAction, BOT_DELAY_MS } from "./bots";
import { fallbackSeatName } from "@/lib/game/names";
import {
  isRoleNote,
  type RoleNotes,
  type RoleNotesDocument,
} from "@/lib/game/roleNotes";
import type {
  Ack,
  RoomConfig,
  RoomMember,
  RoomStatus,
} from "@/lib/socket/types";
import type { ClientEvent, WireRequest } from "@/lib/socket/protocol";
import { buildReplayFromEvents } from "./replay-builder";
import {
  DEFAULT_ATTACHMENT,
  type SocketAttachment,
  type RoomSocket,
} from "./env";
import type { Persistence, RoomDocument, RoomMeta } from "./persistence";
import { makePlayerId, makeSessionToken } from "./ids";
import { normalizeSeatHistory, randomSeatOrder, recordSeats, type SeatHistory } from './seating';
import { weightedRoleAssignment } from '@/lib/engine/roleWeights';

import {
  activePlayers,
  isNameTaken,
  mergeConfig,
  restoreSeatIdentity,
  sanitizeAvatarUrl,
  sanitizeConfig,
  sanitizeName,
  sanitizeRoster,
  snapshot,
} from "./room-helpers";

/** A viewer id guaranteed not to match any seat → projects the spectator view. */
const SPECTATOR_VIEWER = "__spectator__";
/** Sentinel actor name for an admin operator who holds no seat. */
const UNSEATED_ADMIN = "__admin_someone__";
const ok = <T>(data?: T): Ack<T> => ({ ok: true, data });
const fail = <T = undefined>(code: string, message: string): Ack<T> => ({
  ok: false,
  error: { code, message },
});

/** One serial command queue per room; PostgreSQL owns the durable state. */
export class Room {
  private meta: RoomMeta | null = null;
  private members = new Map<string, RoomMember>();
  private game: GameState | null = null;
  private eventSeq = 0;
  private events: RoomDocument["events"] = [];
  private sessions: RoomDocument["sessions"] = {};
  private accounts: Record<string, string> = {};
  private gameAccounts: Record<string, string> = {};
  private lastGameSeats: SeatHistory = { byPlayer: {}, byAccount: {} };
  private spendAccount: string | undefined;
  private notes: RoomDocument["notes"] = {};
  private archive: RoomDocument["archive"] = null;
  private version = 0;
  private loaded = false;
  private committedDocument: RoomDocument | null = null;
  private committedHash = '';
  private checkpointVersion = 0;
  private integrityFailure: Error | null = null;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  private checkpointTask: Promise<void> | undefined;
  private readonly epoch = randomUUID();
  private reliableSockets = new WeakSet<RoomSocket>();
  private committedViews = new WeakMap<RoomSocket, ViewSnapshot>();
  private committedAttachments = new WeakMap<RoomSocket, SocketAttachment>();
  private viewsDirty = false;
  private viewRevision = 0;
  private forceViews = new WeakSet<RoomSocket>();
  private latencies = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private sockets = new Set<RoomSocket>();
  private reconnectOnly = new WeakSet<RoomSocket>();
  private outgoing: Array<() => void> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | undefined;
  lastUsed = Date.now();

  constructor(
    readonly code: string,
    private readonly persistence: Persistence,
  ) {}

  get idle(): boolean {
    return this.sockets.size === 0 && this.pending === 0 && !this.botTimer && !this.checkpointTimer && !this.checkpointTask;
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
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = undefined;
    await this.checkpointTask;
    await this.checkpoint();
  }

  private scheduleCheckpoint(): void {
    if (this.integrityFailure || !this.persistence.checkpointRoom || this.version <= this.checkpointVersion) return;
    if (this.version - this.checkpointVersion >= CHECKPOINT_EVERY && !this.checkpointTask) {
      void this.checkpoint();
    } else if (!this.checkpointTimer) {
      this.checkpointTimer = setTimeout(() => {
        this.checkpointTimer = undefined;
        void this.checkpoint();
      }, CHECKPOINT_INTERVAL_MS);
      this.checkpointTimer.unref?.();
    }
  }

  private async checkpoint(): Promise<void> {
    if (this.integrityFailure || !this.persistence.checkpointRoom || !this.loaded || !this.committedDocument ||
      this.version <= this.checkpointVersion || this.checkpointTask) return;
    const version = this.version;
    const document = this.committedDocument;
    this.checkpointTask = this.persistence.checkpointRoom(this.code, version, document)
      .then(() => { this.checkpointVersion = version; })
      .catch((error) => {
        console.error('[room] checkpoint verification failed; journal retained', error);
        if (error instanceof JournalIntegrityError) {
          // Quarantine this runtime: do not acknowledge more writes atop corrupt recovery history.
          this.integrityFailure = error;
          if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
          this.checkpointTimer = undefined;
          if (this.botTimer) clearTimeout(this.botTimer);
          this.botTimer = undefined;
          for (const ws of this.sockets) {
            this.reconnectOnly.add(ws);
            ws.close(1012, 'Room recovery verification failed');
          }
        }
      })
      .finally(() => {
        this.checkpointTask = undefined;
        if (!this.integrityFailure && this.loaded && this.version > this.checkpointVersion && !this.checkpointTimer) {
          this.checkpointTimer = setTimeout(() => {
            this.checkpointTimer = undefined;
            void this.checkpoint();
          }, CHECKPOINT_INTERVAL_MS);
          this.checkpointTimer.unref?.();
        }
      });
    await this.checkpointTask;
  }

  private document(): RoomDocument {
    return {
      schemaVersion: 1,
      meta: this.meta!,
      members: [...this.members.values()].map(
        ({ latency: _latency, ...member }) => member,
      ),
      game: this.game,
      eventSeq: this.eventSeq,
      events: this.events,
      sessions: this.sessions,
      notes: this.notes,
      archive: this.archive,
      accounts: this.accounts,
      gameAccounts: this.gameAccounts,
      lastGameSeats: this.lastGameSeats,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const record = await this.persistence.loadRoom(this.code);
    if (record) {
      const d = record.document;
      this.committedDocument = structuredClone(d);
      this.committedHash = documentHash(d);
      this.checkpointVersion = record.version;
      if (d.schemaVersion !== 1 || d.meta.code !== this.code)
        throw new Error("Unsupported room snapshot");
      this.meta = d.meta;
      this.members = new Map(d.members.map((m) => [m.id, m]));
      this.game = d.game;
      this.eventSeq = d.eventSeq;
      this.events = d.events;
      this.sessions = d.sessions;
      this.notes = d.notes;
      this.archive = d.archive;
      this.accounts = d.accounts ?? {};
      this.gameAccounts = d.gameAccounts ?? {};
      // Existing snapshots predate explicit history. Retain their game order,
      // or the surviving lobby order when the previous game has been cleared.
      this.lastGameSeats = normalizeSeatHistory(d.lastGameSeats ?? recordSeats(
        d.game?.players ?? d.members.filter((member) => member.claimed && !member.isSpectator),
        this.accounts,
      ));
      this.version = record.version;
      // TCP connections cannot survive a process restart; seat tokens can.
      for (const member of this.members.values()) {
        member.connected = !!member.isBot || !!this.wsForPlayer(member.id);
        delete member.latency;
      }
    } else {
      this.committedDocument = null;
      this.committedHash = '';
      this.meta = null;
      this.members.clear();
      this.game = null;
      this.eventSeq = 0;
      this.events = [];
      this.sessions = {};
      this.notes = {};
      this.archive = null;
      this.accounts = {};
      this.gameAccounts = {};
      this.lastGameSeats = { byPlayer: {}, byAccount: {} };
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
        this.viewsDirty = false;
        this.spendAccount = undefined;
        const result = await fn();
        if (this.integrityFailure) throw this.integrityFailure;
        if (this.meta && !readOnly) {
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
        for (const ws of this.sockets) this.committedAttachments.set(ws, structuredClone(this.attach(ws)));
        for (const send of outgoing) send();
        if (this.viewsDirty) this.publishViews();
        if (!readOnly) this.scheduleCheckpoint();
        this.scheduleBots();
        return result;
      } catch (error) {
        // A lost COMMIT response is ambiguous: always reload PostgreSQL next time.
        if (this.botTimer) clearTimeout(this.botTimer);
        this.botTimer = undefined;
        this.loaded = false;
        this.committedViews = new WeakMap();
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
    const pending = this.game?.actionTimers?.filter((timer) =>
      timer.pausedAt === undefined && this.members.get(timer.playerId)?.isBot && this.members.get(timer.playerId)?.claimed,
    ) ?? [];
    if (!pending.length) return;
    const due = Math.min(...pending.map((timer) => timer.startedAt + BOT_DELAY_MS));
    this.botTimer = setTimeout(() => {
      this.botTimer = undefined;
      void this.run(async () => {
        // Re-read after entering the serial queue: a referee may have changed phase.
        const ready = this.game?.actionTimers?.filter((timer) => timer.pausedAt === undefined &&
          this.members.get(timer.playerId)?.isBot && this.members.get(timer.playerId)?.claimed &&
          timer.startedAt + BOT_DELAY_MS <= Date.now()) ?? [];
        for (const timer of ready) {
          if (!this.game?.actionTimers?.some((current) => current.playerId === timer.playerId &&
            current.action === timer.action && current.startedAt === timer.startedAt)) continue;
          const result = await this.applyEvent(botAction(this.game, timer, `${this.meta!.seed}:bot:${this.eventSeq + 1}:${timer.playerId}`));
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
      if (this.meta) return { ok: false, error: "ROOM_EXISTS" };
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
      for (const s of seats) this.persistPlayer(s);
      this.persistPlayerSession(creatorSeat.id, playerToken);
      if (input.creator.account) this.accounts[creatorSeat.id] = input.creator.account;
      this.meta = {
        code: input.code,
        hostToken,
        hostAccount: input.creator.account,
        status: "lobby",
        config,
        gameId: null,
        seed: null,
      };
      this.members = new Map(seats.map((s) => [s.id, s]));
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
      if (!this.meta) return null;
      const seated = activePlayers(this.members);
      return {
        code: this.meta.code,
        status: this.meta.status,
        playerCount: seated.filter((member) => member.claimed).length,
        maxPlayers: this.meta.config.maxPlayers,
        allowSpectators: this.meta.config.allowSpectators,
        allowMidJoin: this.meta.config.allowMidJoin,
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
      const committed = this.committedViews.get(ws);
      const sync = committed ? { epoch: committed.epoch, revision: committed.revision, hash: committed.hash } : null;
      this.sendAck(ws, req.id, ok<HeartbeatState>({ sync }));
      this.handlePing(ws, req.payload);
      return;
    }
    if (req.event === 'room:resync') {
      const committed = this.committedViews.get(ws);
      if (this.integrityFailure || this.reconnectOnly.has(ws) || !committed) this.sendAck(ws, req.id, fail('NOT_JOINED', 'Join the room first'));
      else {
        this.sendView(ws, committed, true);
        this.sendAck(ws, req.id, ok());
      }
      return;
    }
    try {
      const res = await this.run(async () => {
        if (this.reconnectOnly.has(ws))
          return fail("RECONNECT", "Reconnect to reload room state");
        return await this.dispatch(ws, req.event, req.payload);
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
      await this.handleDisconnect(ws);
    });
  }

  webSocketError(_ws: RoomSocket, error: unknown): void {
    console.error("[room] ws error", error);
  }

  private dispatch(
    ws: RoomSocket,
    event: ClientEvent,
    payload: unknown,
  ): Promise<Ack<unknown>> | Ack<unknown> {
    switch (event) {
      case "notes:sync":
        return this.handleNotesSync(ws, payload);
      case "room:join":
        return this.handleJoin(ws, payload);
      case "room:addBot":
        return this.handleAddBot(ws);
      case "room:claimSeat":
        return this.handleClaimSeat(ws, payload);
      case "room:releaseSeat":
        return this.handleReleaseSeat(ws);
      case "room:setRoster":
        return this.handleSetRoster(ws, payload);
      case "room:removeSeat":
        return this.handleRemoveSeat(ws, payload);
      case "room:restart":
        return this.handleRestart(ws);
      case "room:config":
        return this.handleConfig(ws, payload);
      case "room:rename":
        return this.handleRename(ws, payload);
      case "room:kick":
        return this.handleKick(ws, payload);
      case "room:transferHost":
        return fail("NOT_SUPPORTED", "Host transfer is not available");
      case "room:start":
        return this.handleStart(ws);
      case "room:leave":
        return this.handleLeave(ws);
      case "game:useRerollCard":
        return this.handleUseRerollCard(ws, payload);
      case "game:ackRole":
        return this.gameAction(ws, (pid) => ({
          type: "ACK_ROLE",
          by: pid,
          roleRevision: (payload as { roleRevision?: number } | null)
            ?.roleRevision,
        }));
      case "game:proposeTeam":
        return this.gameAction(ws, (pid) => ({
          type: "PROPOSE_TEAM",
          by: pid,
          team: asStrArray((payload as { team?: unknown }).team),
        }));
      case "game:finalizeTeam":
        return this.gameAction(ws, (pid) => ({
          type: "FINALIZE_TEAM",
          by: pid,
          team: asStrArray((payload as { team?: unknown } | null)?.team),
        }));
      case "game:startDiscussion":
        return this.gameAction(ws, (pid) => ({
          type: "START_DISCUSSION",
          by: pid,
          direction: (payload as { direction?: "clockwise" | "counterclockwise" } | null)?.direction,
        }));
      case "game:endSpeech":
        return this.gameAction(ws, (pid) => ({ type: "END_SPEECH", by: pid }));
      case "game:vote":
        return this.gameAction(ws, (pid) => ({
          type: "CAST_VOTE",
          by: pid,
          value: (payload as { value: "approve" | "reject" }).value,
        }));
      case "game:missionCard":
        return this.gameAction(ws, (pid) => ({
          type: "CAST_MISSION_CARD",
          by: pid,
          card: (payload as { card: "success" | "fail" }).card,
        }));
      case "game:useLady":
        return this.gameAction(ws, (pid) => ({
          type: "USE_LADY",
          by: pid,
          target: (payload as { targetPlayerId: string }).targetPlayerId,
        }));
      case "game:startAssassination":
        return this.gameAction(ws, (pid) => ({
          type: "START_ASSASSINATION",
          by: pid,
        }));
      case "game:assassinate":
        return this.gameAction(ws, (pid) => ({
          type: "ASSASSINATE",
          by: pid,
          target: (payload as { targetPlayerId: string }).targetPlayerId,
        }));
      case "net:ping":
        return this.handlePing(ws, payload);
      case "admin:auth":
        return this.handleAdminAuth(ws);
      case "admin:close":
        return this.handleAdminClose(ws);
      case "admin:unbind":
        return this.handleAdminUnbind(ws, payload);
      case "admin:vote":
        return this.handleAdminVote(ws, payload);
      case "admin:propose":
        return this.handleAdminPropose(ws, payload);
      case "admin:retractVotes":
        return this.handleAdminRetract(ws, "votes");
      case "admin:retractProposal":
        return this.handleAdminRetract(ws, "proposal");
      case "admin:startAssassination":
        return this.handleAdminPhase(ws, "assassination");
      case "admin:previousPhase":
        return this.handleAdminPhase(ws, "previous");
      case "admin:skipSpeech":
        return this.handleAdminSkipSpeech(ws, payload);
      case "admin:setTimersPaused":
        return this.handleAdminSetTimersPaused(ws, payload);
      case "admin:rerollLeader":
        return this.handleAdminReroll(ws, "REROLL_LEADER");
      case "admin:rerollRoles":
        return this.handleAdminReroll(ws, "REROLL_ROLES");
      default:
        return fail("UNKNOWN_EVENT", `Unknown event: ${String(event)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Room handlers (ported from handlers.ts)
  // ---------------------------------------------------------------------------

  private handleNotesSync(
    ws: RoomSocket,
    payload: unknown,
  ): Ack<RoleNotesDocument> {
    const playerId = this.attach(ws).playerId;
    if (
      !playerId ||
      !this.members.get(playerId)?.claimed ||
      this.wsForPlayer(playerId) !== ws
    ) {
      return fail("NOT_SEATED", "A current seat connection is required");
    }
    if (!this.game || !this.meta?.gameId)
      return fail("NO_GAME", "No game in progress");
    if (!payload || typeof payload !== "object")
      return fail("INVALID", "Invalid notes request");
    const p = payload as Record<string, unknown>;
    const roleRevision = this.game.roleRevision ?? 0;
    if (
      p.gameId !== this.meta.gameId ||
      p.roleRevision !== roleRevision ||
      p.playerId !== playerId
    ) {
      return fail(
        "STALE_NOTES_SCOPE",
        "The game, role assignment or seat has changed",
      );
    }
    const stored = this.notes[playerId];
    const current: RoleNotesDocument =
      stored?.gameId === this.meta.gameId &&
      stored.roleRevision === roleRevision
        ? stored
        : {
            gameId: this.meta.gameId,
            roleRevision,
            playerId,
            revision: 0,
            notes: {},
            enabled: true,
          };
    if (p.update === undefined) return ok(current);
    if (!p.update || typeof p.update !== "object")
      return fail("INVALID", "Invalid notes update");
    const update = p.update as Record<string, unknown>;
    if (
      !Number.isSafeInteger(update.baseRevision) ||
      typeof update.enabled !== "boolean" ||
      !update.notes ||
      typeof update.notes !== "object" ||
      Array.isArray(update.notes)
    ) {
      return fail("INVALID", "Invalid notes update");
    }
    const entries = Object.entries(update.notes);
    if (
      entries.length > this.game.players.length ||
      entries.some(
        ([id, note]) =>
          !this.game!.players.some((player) => player.id === id) ||
          !isRoleNote(note),
      )
    )
      return fail("INVALID", "Invalid player or note");
    if (update.baseRevision !== current.revision) {
      return {
        ok: false,
        error: {
          code: "NOTES_CONFLICT",
          message: "Notes changed; merge and retry",
        },
        data: current,
      };
    }
    const notes = Object.fromEntries(entries) as RoleNotes;
    const document = {
      ...current,
      revision: current.revision + 1,
      notes,
      enabled: update.enabled,
    };
    this.notes[playerId] = document;
    return ok(document);
  }

  private async handleJoin(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack<{ playerId?: string; playerToken?: string; isHost: boolean }>> {
    if (!this.meta) return fail("ROOM_NOT_FOUND", "Room not found");
    const { playerId, playerToken, hostToken } = (payload ?? {}) as {
      playerId?: string;
      playerToken?: string;
      hostToken?: string;
    };

    if ((payload as { syncVersion?: number } | null)?.syncVersion === 1) {
      this.reliableSockets.add(ws);
      this.forceViews.add(ws);
    }
    const account = this.attach(ws).account!;
    // Account ownership takes precedence over browser-local reconnect tokens.
    const ownedSeat = [...this.members.values()].find(
      (member) => member.claimed && this.accounts[member.id] === account,
    );
    const legacySeat = playerId && playerToken &&
      !this.accounts[playerId] && this.playerSessionToken(playerId) === playerToken
      ? this.members.get(playerId) : undefined;
    const member = ownedSeat ?? (legacySeat?.claimed ? legacySeat : undefined);
    const isHost = this.meta.hostAccount
      ? this.meta.hostAccount === account
      : !!hostToken && hostToken === this.meta.hostToken;
    if (isHost) this.meta.hostAccount = account;
    this.setAttach(ws, { playerId: undefined, isHost });

    // Retire old devices only after the new binding has committed successfully.
    for (const existing of this.sockets) {
      if (existing === ws) continue;
      const attachment = this.attach(existing);
      if (attachment.account !== account && (!member || attachment.playerId !== member.id)) continue;
      this.setAttach(existing, { playerId: undefined, isHost: false, isAdmin: false });
      this.send(existing, "system:notice", { type: "session_replaced" });
      if (this.game) this.syncSpectator(existing);
      this.outgoing!.push(() => {
        this.reconnectOnly.add(existing);
        existing.close(4001, "Room opened on another device");
      });
    }

    if (member) {
      const playerId = member.id;
      const playerToken = this.playerSessionToken(playerId) ?? makeSessionToken();
      this.persistPlayerSession(playerId, playerToken);
      member.connected = true;
      this.persistPlayer(member);
      this.setAttach(ws, { playerId, isHost });
      this.bindAccount(ws, playerId);
      if (this.game)
        await this.applyEvent({ type: "SET_CONNECTED", by: playerId, connected: true });
      this.broadcastRoom();
      if (this.game) this.syncOne(playerId);
      return ok({ playerId, playerToken, isHost });
    }

    // Unseated → spectator view.
    this.broadcastRoom();
    if (this.game) this.syncSpectator(ws);
    return ok({ isHost });
  }

  private handleAddBot(ws: RoomSocket): Ack {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "lobby") return fail("WRONG_PHASE", "Game already started");
    const seats = activePlayers(this.members);
    let target = seats.find((member) => !member.claimed);
    if (!target) {
      if (seats.length >= 10) return fail("ROOM_FULL", "All 10 seats are taken");
      target = { id: makePlayerId(), name: '', seat: seats.length, isSpectator: false, claimed: false, connected: false };
      this.meta.config.roster.push(fallbackSeatName(target.seat));
    }
    let number = 1;
    while (isNameTaken(this.members, `Bot ${number}`, target.id)) number++;
    target.name = `Bot ${number}`;
    target.isBot = true;
    target.claimed = true;
    target.connected = true;
    delete target.avatarUrl;
    delete target.latency;
    this.persistPlayer(target);
    this.broadcastRoom();
    return ok();
  }

  private async handleClaimSeat(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack<{ playerId: string; playerToken: string }>> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const { seatId: requestedSeatId, name, avatarUrl } = (payload ?? {}) as {
      seatId?: string;
      name?: unknown;
      avatarUrl?: unknown;
    };
    const prevId = this.attach(ws).playerId;
    const automatic = requestedSeatId === undefined;
    if (automatic && this.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Choose an existing seat during a game");
    const seats = activePlayers(this.members);
    let target = requestedSeatId ? this.members.get(requestedSeatId) : undefined;
    if (automatic) {
      target = seats.find((member) => member.id === prevId && member.claimed)
        ?? seats.find((member) => !member.claimed);
      if (!target) {
        if (seats.length >= 10) return fail("ROOM_FULL", "All 10 seats are taken");
        target = {
          id: makePlayerId(), name: fallbackSeatName(seats.length), seat: seats.length,
          isSpectator: false, claimed: false, connected: false,
        };
      }
    }
    if (!target || target.isSpectator)
      return fail("UNKNOWN_SEAT", "No such seat");
    const seatId = target.id;
    const holder = this.wsForPlayer(seatId);
    if (target.claimed && holder !== ws)
      return fail("SEAT_TAKEN", "That seat is already taken");

    const account = this.attach(ws).account;
    if (account && seats.some((member) => member.claimed && member.id !== prevId && member.id !== seatId && this.accounts[member.id] === account))
      return fail("ALREADY_SEATED", "This account already has a seat in the room");
    const desiredName = typeof name === "string" ? sanitizeName(name) : "";
    const desiredAvatarUrl = sanitizeAvatarUrl(avatarUrl);
    if ((automatic || name !== undefined) && !desiredName)
      return fail("INVALID_NAME", "Name cannot be empty");
    if (
      desiredName &&
      [...this.members.values()].some(
        (member) =>
          member.id !== seatId &&
          member.id !== prevId &&
          member.claimed &&
          member.name.toLowerCase() === desiredName.toLowerCase(),
      )
    ) {
      return fail("NAME_TAKEN", "That name is already taken in this room");
    }
    if (!this.members.has(seatId)) {
      this.meta.config.roster.push(fallbackSeatName(target.seat));
    }
    if (prevId && prevId !== seatId) {
      this.releaseSeat(prevId);
      if (this.game)
        await this.applyEvent({
          type: "SET_CONNECTED",
          by: prevId,
          connected: false,
        });
    }

    const playerToken = this.playerSessionToken(seatId) ?? makeSessionToken();
    this.persistPlayerSession(seatId, playerToken);
    if (desiredName) target.name = desiredName;
    if (desiredAvatarUrl) target.avatarUrl = desiredAvatarUrl;
    else delete target.avatarUrl;
    target.claimed = true;
    target.connected = true;
    this.persistPlayer(target);
    this.setAttach(ws, { playerId: seatId });
    this.bindAccount(ws, seatId);
    if (this.game)
      await this.applyEvent({
        type: "SET_CONNECTED",
        by: seatId,
        connected: true,
      });
    this.broadcastRoom();
    if (this.game) this.syncOne(seatId);
    return ok({ playerId: seatId, playerToken });
  }

  private async handleReleaseSeat(ws: RoomSocket): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const pid = this.attach(ws).playerId;
    if (!pid) return ok();
    this.releaseSeat(pid);
    if (this.game) {
      await this.applyEvent({
        type: "SET_CONNECTED",
        by: pid,
        connected: false,
      });
      this.syncSpectator(ws);
    }
    this.broadcastRoom();
    return ok();
  }

  private async handleSetRoster(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Game already started");
    const { names } = (payload ?? {}) as { names?: string[] };
    const res = await this.applyRoster(names ?? []);
    if (!res.ok) return res;
    this.broadcastRoom();
    return ok();
  }

  private handleConfig(ws: RoomSocket, payload: unknown): Ack {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Game already started");
    const { config } = (payload ?? {}) as { config?: RoomConfig };
    if (!config) return fail("INVALID", "No config");
    this.meta.config = resolveRoomConfig(
      sanitizeConfig(config, this.meta.config.roster),
      activePlayers(this.members).filter((member) => member.claimed).length,
    );
    this.persistConfig();
    this.broadcastRoom();
    return ok();
  }

  private handleRemoveSeat(ws: RoomSocket, payload: unknown): Ack {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Game already started");
    const { seatId } = (payload ?? {}) as { seatId?: string };
    const target = seatId ? this.members.get(seatId) : undefined;
    if (!target || target.isSpectator)
      return fail("UNKNOWN_SEAT", "No such seat");
    if (target.claimed)
      return fail("SEAT_CLAIMED", "Cannot remove a claimed seat");
    const seats = activePlayers(this.members);
    if (seats.length <= 1)
      return fail("INVALID_PLAYER_COUNT", "Keep at least one seat");

    const remaining = seats
      .filter((seat) => seat.id !== target.id)
      .map((seat, index) => ({ ...seat, seat: index }));
    const roster = this.meta.config.roster.filter(
      (_, index) => index !== target.seat,
    );
    const config = { ...this.meta.config, roster };
    this.deletePlayer(target.id);
    for (const seat of remaining) this.persistPlayer(seat);
    this.members.delete(target.id);
    for (const seat of remaining) this.members.set(seat.id, seat);
    this.meta.config = config;
    this.broadcastRoom();
    return ok();
  }

  private async handleRestart(ws: RoomSocket): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "finished" || this.game?.phase !== "GameOver") {
      return fail(
        "WRONG_PHASE",
        "The game must finish before returning to the lobby",
      );
    }
    this.events = [];
    this.notes = {};
    this.archive = null;
    this.meta.status = "lobby";
    this.meta.gameId = null;
    this.meta.seed = null;
    this.eventSeq = 0;
    this.game = null;
    for (const socket of [...this.sockets])
      this.setAttach(socket, { isAdmin: false });
    this.broadcastRoom();
    return ok();
  }

  private handleRename(
    ws: RoomSocket,
    payload: unknown,
  ): Ack<{ name: string }> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const pid = this.attach(ws).playerId;
    if (!pid) return fail("NOT_IN_ROOM", "No player id");
    const member = this.members.get(pid);
    if (!member) return fail("UNKNOWN_PLAYER", "No such player");
    const { name } = (payload ?? {}) as { name?: string };
    const desired = sanitizeName(name ?? "");
    if (!desired) return fail("INVALID_NAME", "Name cannot be empty");
    if (isNameTaken(this.members, desired, pid)) {
      return fail("NAME_TAKEN", "That name is already taken in this room");
    }
    member.name = desired;
    this.persistPlayer(member);
    this.broadcastRoom();
    return ok({ name: desired });
  }

  private async handleKick(ws: RoomSocket, payload: unknown): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Cannot kick mid-game");
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: string };
    if (!targetPlayerId || !this.members.has(targetPlayerId)) {
      return fail("UNKNOWN_PLAYER", "No such seat");
    }
    const targetWs = this.wsForPlayer(targetPlayerId);
    if (targetWs)
      this.send(targetWs, "system:notice", {
        type: "kicked",
        message: "You were removed",
      });
    this.releaseSeat(targetPlayerId);
    this.broadcastRoom();
    return ok();
  }

  private async handleStart(ws: RoomSocket): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Already started");

    const seats = activePlayers(this.members);
    const participants = seats.filter((member) => member.claimed);
    if (participants.length < 5 || participants.length > 10) {
      return fail("INVALID_PLAYER_COUNT", "Need 5–10 seated players to deal");
    }
    this.meta.config = resolveRoomConfig(this.meta.config, participants.length);
    try {
      buildRoleSet(participants.length, this.meta.config.options);
    } catch (e) {
      return fail("INVALID_ROLE_SET", (e as Error).message);
    }

    const seed = `${this.meta.code}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let seated;
    try {
      seated = randomSeatOrder(participants, (member) => {
        const account = this.accounts[member.id];
        return (account ? this.lastGameSeats?.byAccount?.[account] : undefined)
          ?? this.lastGameSeats?.byPlayer?.[member.id];
      }, createRng(`${seed}:seats`));
    } catch {
      seated = createRng(`${seed}:seats:fallback`).shuffle(participants);
    }
    const created = createGame({
      hostId: seated[0]!.id,
      players: seated.map((m) => ({ id: m.id, name: m.name })),
      options: this.meta.config.options,
      seed,
    });
    if (!created.ok) return fail(created.error.code, created.error.message);

    // Old rooms and released seats may still contain placeholders. Deal only to
    // actual participants, retaining their IDs/tokens in the randomized order.
    const roster = seated.map((member, index) => this.meta!.config.roster[member.seat] ?? fallbackSeatName(index));
    for (const member of seats) {
      if (member.claimed) continue;
      this.deletePlayer(member.id);
      delete this.accounts[member.id];
      delete this.notes[member.id];
    }
    seated.forEach((member, index) => { member.seat = index; });
    this.meta.config.roster = roster;
    this.lastGameSeats = recordSeats(seated, this.accounts);

    const gameId = makePlayerId();
    this.gameAccounts = Object.fromEntries(seated.filter((m) => m.claimed && this.accounts[m.id]).map((m) => [m.id, this.accounts[m.id]!]));
    this.events = []; // fresh log for the new game
    this.notes = {};
    this.game = created.state;
    this.meta.gameId = gameId;
    this.meta.seed = seed;
    this.eventSeq = 0;
    this.meta.status = "in_game";

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

  // ---------------------------------------------------------------------------
  // Game actions & referee (admin) actions
  // ---------------------------------------------------------------------------

  private bindAccount(ws: RoomSocket, playerId: string): void {
    const account = this.attach(ws).account;
    if (this.gameAccounts[playerId] && this.gameAccounts[playerId] !== account)
      delete this.gameAccounts[playerId];
    if (account) {
      this.accounts[playerId] = account;
      const seat = this.game?.players.find((player) => player.id === playerId)?.seat;
      // A replacement or a player changing seats mid-game must also move next game.
      if (seat !== undefined) this.lastGameSeats.byAccount[account] = seat;
    }
    else delete this.accounts[playerId];
  }

  private async handleUseRerollCard(ws: RoomSocket, payload: unknown): Promise<Ack> {
    const { playerId, account } = this.attach(ws);
    if (!account) return fail('AUTH_REQUIRED', 'Sign in to use reroll cards');
    if (!playerId || this.accounts[playerId] !== account || !this.members.get(playerId)?.claimed)
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
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const pid = this.attach(ws).playerId;
    if (!pid) return fail("NOT_IN_ROOM", "No player id");
    return this.applyEvent(build(pid));
  }

  private handlePing(ws: RoomSocket, payload: unknown): Ack {
    const pid = this.committedAttachments.get(ws)?.playerId;
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

  private handleAdminAuth(ws: RoomSocket): Ack<{ ok: boolean }> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    this.setAttach(ws, { isAdmin: true });
    if (this.game)
      this.pushAdminLog("admin.panelOpened", {
        actor: this.adminActorName(ws),
      });
    return ok({ ok: true });
  }

  private handleAdminClose(ws: RoomSocket): Ack {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin) return ok();
    this.setAttach(ws, { isAdmin: false });
    if (this.game)
      this.pushAdminLog("admin.panelClosed", {
        actor: this.adminActorName(ws),
      });
    return ok();
  }

  private async handleAdminUnbind(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: string };
    const target = targetPlayerId
      ? this.members.get(targetPlayerId)
      : undefined;
    if (!targetPlayerId || !target || target.isSpectator)
      return fail("UNKNOWN_PLAYER", "No such seat");

    const actor = this.adminActorName(ws);
    const targetName = target.name;
    const targetWs = this.wsForPlayer(targetPlayerId);
    this.releaseSeat(targetPlayerId);
    if (targetWs) {
      this.send(targetWs, "system:notice", {
        type: "unbound",
        message: "You were unbound by a referee",
      });
    }
    if (this.game)
      await this.applyEvent({
        type: "SET_CONNECTED",
        by: targetPlayerId,
        connected: false,
      });
    this.pushAdminLog("admin.unbound", { actor, target: targetName });
    this.broadcastRoom();
    if (this.game && targetWs) this.syncSpectator(targetWs);
    return ok();
  }

  private async handleAdminVote(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { targetPlayerId, value } = (payload ?? {}) as {
      targetPlayerId?: string;
      value?: "approve" | "reject";
    };
    const target = targetPlayerId
      ? this.members.get(targetPlayerId)
      : undefined;
    if (!targetPlayerId || !target || target.isSpectator)
      return fail("UNKNOWN_PLAYER", "No such player");
    if (value !== "approve" && value !== "reject")
      return fail("INVALID", "Invalid vote");
    const res = await this.applyEvent({
      type: "CAST_VOTE",
      by: targetPlayerId,
      value,
      admin: true,
    });
    if (!res.ok) return res;
    this.pushAdminLog("admin.votedFor", {
      actor: this.adminActorName(ws),
      target: target.name,
      value,
    });
    return ok();
  }

  private async handleAdminPropose(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    if (!this.game) return fail("NO_GAME", "No game in progress");
    if (
      this.game.phase !== "TeamBuilding" &&
      this.game.phase !== "TeamFinalizing"
    )
      return fail("WRONG_PHASE", "Not choosing a team");
    const { team } = (payload ?? {}) as { team?: unknown };
    const leader = leaderId(this.game);
    const res = await this.applyEvent({
      type:
        this.game.phase === "TeamFinalizing" ? "FINALIZE_TEAM" : "PROPOSE_TEAM",
      by: leader,
      team: asStrArray(team),
      admin: true,
    });
    if (!res.ok) return res;
    const leaderName = this.members.get(leader)?.name ?? leader;
    this.pushAdminLog("admin.proposedFor", {
      actor: this.adminActorName(ws),
      leader: leaderName,
    });
    return ok();
  }

  private async handleAdminRetract(
    ws: RoomSocket,
    which: "votes" | "proposal",
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    if (!this.game) return fail("NO_GAME", "No game in progress");
    const res = await this.applyEvent(
      which === "votes"
        ? { type: "RETRACT_VOTES" }
        : { type: "RETRACT_PROPOSAL" },
    );
    if (!res.ok) return res;
    this.pushAdminLog(
      which === "votes" ? "admin.votesRetracted" : "admin.proposalRetracted",
      { actor: this.adminActorName(ws) },
    );
    return ok();
  }

  private async handleAdminPhase(
    ws: RoomSocket,
    action: "assassination" | "previous",
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    if (!this.game) return fail("NO_GAME", "No game in progress");
    const actor = this.adminActorName(ws);
    const res = await this.applyEvent(
      action === "previous"
        ? { type: "PREVIOUS_PHASE", actor }
        : {
            type: "START_ASSASSINATION",
            by: this.game.assassinId ?? "",
            admin: true,
            actor,
          },
    );
    if (res.ok) this.broadcastRoom();
    return res;
  }

  private async handleAdminSetTimersPaused(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { paused } = (payload ?? {}) as { paused?: unknown };
    if (typeof paused !== "boolean")
      return fail("INVALID", "Invalid timer state");
    return this.applyEvent({
      type: "SET_TIMERS_PAUSED",
      paused,
      actor: this.adminActorName(ws),
    });
  }

  private async handleAdminSkipSpeech(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: unknown };
    if (typeof targetPlayerId !== "string" || !targetPlayerId)
      return fail("INVALID", "Missing speaker");
    return this.applyEvent({
      type: "SKIP_SPEECH",
      target: targetPlayerId,
      actor: this.adminActorName(ws),
    });
  }

  private async handleAdminReroll(
    ws: RoomSocket,
    type: "REROLL_LEADER" | "REROLL_ROLES",
  ): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    return this.applyEvent({ type, actor: this.adminActorName(ws) });
  }

  // ---------------------------------------------------------------------------
  // Leave / disconnect
  // ---------------------------------------------------------------------------

  private async handleLeave(ws: RoomSocket): Promise<Ack> {
    if (!this.meta) return ok();
    const pid = this.attach(ws).playerId;
    if (!pid) {
      this.broadcastRoom();
      return ok();
    }
    this.releaseSeat(pid);
    if (this.game)
      await this.applyEvent({
        type: "SET_CONNECTED",
        by: pid,
        connected: false,
      });
    this.broadcastRoom();
    return ok();
  }

  private async handleDisconnect(ws: RoomSocket): Promise<void> {
    if (!this.meta) return;
    const pid = this.attach(ws).playerId;
    if (!pid) return;
    // Superseded by a reconnect on another socket → this close is stale.
    const superseded = [...this.sockets].some(
      (w) => w !== ws && this.attach(w).playerId === pid,
    );
    if (superseded) return;

    const member = this.members.get(pid);
    // A transport disconnect is not an explicit departure: retain account ownership.
    if (member) {
      member.connected = false;
      delete member.latency;
      this.latencies.delete(pid);
      this.persistPlayer(member);
    }
    if (this.game)
      await this.applyEvent({ type: "SET_CONNECTED", by: pid, connected: false });
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------------------
  // Engine application + projection + broadcast (ported from runtime.ts)
  // ---------------------------------------------------------------------------

  private async applyEvent(event: GameEvent): Promise<Ack> {
    if (!this.game || !this.meta || !this.meta.seed)
      return fail("NO_GAME", "No game in progress");
    const prevState = this.game;
    const seq = this.eventSeq + 1;
    const ctx: EngineContext = {
      now: Date.now(),
      rng: createRng(`${this.meta.seed}:${seq}`),
    };
    if (event.type === 'START_GAME' || event.type === 'REROLL_ROLES' || event.type === 'USE_REROLL_CARD') {
      try {
        const weights = await this.persistence.getRoleWeights(Object.values(this.accounts));
        const byPlayer = Object.fromEntries(this.game.players.map((player) => [player.id, weights[this.accounts[player.id]!]]));
        const requesterId = event.type === 'USE_REROLL_CARD' ? event.by : undefined;
        const requester = this.game.players.find((player) => player.id === requesterId);
        const assignedRoles = weightedRoleAssignment(
          this.game.players, this.game.config.roles, byPlayer, createRng(`${this.meta.seed}:${seq}:roles`),
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

    if (result.state.roleRevision !== prevState.roleRevision) this.notes = {};
    this.game = result.state;
    this.eventSeq = seq;
    this.events.push({ seq, event, createdAt: ctx.now });

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
      for (const member of this.members.values()) {
        if (member.claimed && !member.isSpectator)
          this.sendPrivateReveal(member.id);
      }
    }
    return ok();
  }

  /** The archive is committed in the same PostgreSQL transaction as GameOver. */
  private prepareReplayArchive(): void {
    if (!this.meta?.gameId || !this.meta.seed)
      throw new Error("No game to archive");
    const seated = activePlayers(this.members).map((m) => ({
      id: m.id,
      name: m.name,
    }));
    const replay = buildReplayFromEvents(
      this.meta.gameId,
      this.meta.seed,
      this.meta.config.options,
      seated,
      this.events,
    );
    if (!replay?.outcome)
      throw new Error("Cannot archive an incomplete replay");
    this.archive = {
      replay, revision: this.eventSeq, rewardAccounts: [...new Set(Object.values(this.gameAccounts))],
      roleWeightAssignments: Object.fromEntries(this.game!.players.flatMap((player) => {
        const account = this.members.get(player.id)?.claimed ? this.accounts[player.id] : undefined;
        return account ? [[account, player.role]] : [];
      })),
    };
  }

  private project(playerId: string): ClientGameState {
    const view = projectStateForViewer(this.game!, playerId);
    view.serverTime = Date.now();
    view.gameId = this.meta?.gameId ?? null;
    for (const p of view.players) {
      const member = this.members.get(p.id);
      // Presence comes from the live room, not engine defaults or replayed events.
      p.claimed = member?.claimed ?? false;
      p.connected = !!(member?.claimed && member.connected);
      if (!member) continue;
      p.isBot = member.isBot;
      p.name = member.name;
      const latency = this.latencies.get(p.id);
      if (latency !== undefined) p.latency = latency;
      p.avatarUrl = member.avatarUrl;
    }
    return view;
  }

  private broadcastState(): void {
    if (!this.game) return;
    this.viewsDirty = true;
    let spectatorView: ClientGameState | null = null;
    for (const w of [...this.sockets]) {
      if (this.reliableSockets.has(w)) continue;
      const pid = this.attach(w).playerId;
      if (pid && this.members.has(pid)) {
        this.send(w, "state:sync", this.project(pid));
      } else {
        if (!spectatorView) spectatorView = this.project(SPECTATOR_VIEWER);
        this.send(w, "state:sync", spectatorView);
      }
    }
  }

  private broadcastRoom(): void {
    if (!this.meta) return;
    this.viewsDirty = true;
    const snap = this.roomSnapshot();
    for (const w of this.sockets) if (!this.reliableSockets.has(w)) this.send(w, "room:snapshot", snap);
  }

  private sendPrivateReveal(playerId: string): void {
    if (!this.game) return;
    this.viewsDirty = true;
    const socket = this.wsForPlayer(playerId);
    if (socket && this.reliableSockets.has(socket)) return;
    const view = projectStateForViewer(this.game, playerId);
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
    if (!this.game) return;
    this.viewsDirty = true;
    const w = this.wsForPlayer(playerId);
    if (w && !this.reliableSockets.has(w)) this.send(w, "state:sync", this.project(playerId));
  }

  private syncSpectator(ws: RoomSocket): void {
    if (!this.game) return;
    this.viewsDirty = true;
    if (!this.reliableSockets.has(ws)) this.send(ws, "state:sync", this.project(SPECTATOR_VIEWER));
  }

  private pushAdminLog(
    key: string,
    params: Record<string, string | number>,
  ): void {
    if (!this.game) return;
    this.game.logSeq += 1;
    this.game.logs.push({
      seq: this.game.logSeq,
      roundIndex: this.game.roundIndex,
      at: Date.now(),
      channel: "public",
      key,
      params,
      style: "admin",
    });
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Roster reconciliation (ported from handlers.applyRoster)
  // ---------------------------------------------------------------------------

  private async applyRoster(names: string[]): Promise<Ack> {
    if (!this.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const desired = names
      .slice(0, 10)
      .map((n, i) => sanitizeName(n) || fallbackSeatName(i));
    const seats = activePlayers(this.members);
    // Refuse to drop a claimed seat.
    for (let i = desired.length; i < seats.length; i++) {
      if (seats[i]!.claimed)
        return fail("SEAT_CLAIMED", "Cannot remove a claimed seat");
    }
    // Rename existing seats in place.
    for (let i = 0; i < Math.min(desired.length, seats.length); i++) {
      const seat = seats[i]!;
      if (seat.name !== desired[i]) {
        seat.name = desired[i]!;
        this.persistPlayer(seat);
      }
    }
    // Append new seats.
    for (let i = seats.length; i < desired.length; i++) {
      const member: RoomMember = {
        id: makePlayerId(),
        name: desired[i]!,
        seat: i,
        isSpectator: false,
        connected: false,
        claimed: false,
      };
      this.members.set(member.id, member);
      this.persistPlayer(member);
    }
    // Drop trailing unclaimed seats.
    for (let i = desired.length; i < seats.length; i++) {
      const seat = seats[i]!;
      this.members.delete(seat.id);
      this.deletePlayer(seat.id);
    }
    this.meta.config.roster = desired;
    this.persistConfig();
    return ok();
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
    this.viewsDirty = true;
  }

  private wsForPlayer(pid: string): RoomSocket | undefined {
    for (const w of [...this.sockets]) {
      if (this.attach(w).playerId === pid) return w;
    }
    return undefined;
  }

  private currentHostPlayerId(): string | null {
    for (const ws of [...this.sockets]) {
      const attachment = this.attach(ws);
      if (attachment.isHost && attachment.playerId) return attachment.playerId;
    }
    return null;
  }

  /** Release a seat, restoring its roster identity before dropping the binding. */
  private releaseSeat(playerId: string): void {
    delete this.accounts[playerId];
    delete this.gameAccounts[playerId];
    const member = this.members.get(playerId);
    if (member) {
      restoreSeatIdentity(member, this.meta?.config.roster ?? []);
      delete member.isBot;
      member.claimed = false;
      member.connected = false;
      this.persistPlayer(member);
    }
    this.deletePlayerSession(playerId);
    const holder = this.wsForPlayer(playerId);
    if (holder) this.setAttach(holder, { playerId: undefined });
  }

  private adminActorName(ws: RoomSocket): string {
    const pid = this.attach(ws).playerId;
    const member = pid ? this.members.get(pid) : undefined;
    return member?.name ?? UNSEATED_ADMIN;
  }

  private send(ws: RoomSocket, event: string, payload: unknown): void {
    if (['state:sync', 'room:snapshot', 'private:reveal', 'private:lady'].includes(event)) {
      this.viewsDirty = true;
      if (this.reliableSockets.has(ws)) return;
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

  private roomSnapshot() {
    const result = snapshot(this.meta!, this.members, this.currentHostPlayerId());
    return { ...result, members: result.members.map((member) => ({ ...member,
      ...(this.latencies.has(member.id) ? { latency: this.latencies.get(member.id) } : {}),
    })) };
  }

  private publishViews(): void {
    if (!this.meta) return;
    const room = this.roomSnapshot();
    for (const ws of this.sockets) {
      if (!this.reliableSockets.has(ws) || this.reconnectOnly.has(ws)) continue;
      const attachment = this.attach(ws);
      const view: RoomView = {
        room, game: this.game ? this.project(attachment.playerId ?? SPECTATOR_VIEWER) : null,
        playerId: attachment.playerId ?? null, isHost: attachment.isHost, isReferee: attachment.isAdmin,
      };
      const hash = documentHash(viewContent(view));
      const previous = this.committedViews.get(ws);
      if (previous?.hash === hash) {
        if (this.forceViews.has(ws)) this.sendView(ws, previous);
        this.forceViews.delete(ws);
        continue;
      }
      const committed: ViewSnapshot = {
        epoch: this.epoch, revision: ++this.viewRevision, hash, view: structuredClone(view),
      };
      this.committedViews.set(ws, committed);
      this.forceViews.delete(ws);
      this.sendView(ws, committed);
    }
  }

  private sendView(ws: RoomSocket, committed: ViewSnapshot, recovery = false): void {
    this.sendImmediate(ws, 'view:sync', { ...committed, recovery, view: {
      ...committed.view, game: committed.view.game ? { ...committed.view.game, serverTime: Date.now() } : null,
    } });
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
    if (this.meta) this.meta.status = status;
  }

  private persistConfig(): void {
    /* included in the room snapshot */
  }

  private persistPlayer(member: RoomMember): void {
    this.members.set(member.id, member);
  }

  private playerSessionToken(playerId: string): string | null {
    return this.sessions[playerId] ?? null;
  }

  private persistPlayerSession(playerId: string, token: string): void {
    this.sessions[playerId] = token;
  }

  private deletePlayerSession(playerId: string): void {
    delete this.sessions[playerId];
  }

  private deletePlayer(id: string): void {
    this.members.delete(id);
    this.deletePlayerSession(id);
  }
}

/** Coerce an unknown wire value to a string[] (team payloads). */
function asStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
