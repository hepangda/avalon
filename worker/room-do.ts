import { DurableObject } from 'cloudflare:workers';
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
  type GameOptions,
  type GameState,
} from '@/lib/engine';
import { fallbackSeatName } from '@/lib/game/names';
import type { Ack, RoomConfig, RoomMember, RoomStatus } from '@/lib/socket/types';
import type { ClientEvent, WireRequest } from '@/lib/socket/protocol';
import { buildReplayFromEvents } from './replay-builder';
import { DEFAULT_ATTACHMENT, type Env, type SocketAttachment } from './env';
import { makePlayerId, makeSessionToken } from './ids';
import {
  addRealtimeKitParticipant,
  createRealtimeKitMeeting,
  deleteRealtimeKitParticipant,
  getRealtimeKitCredentials,
  RealtimeKitApiError,
  refreshRealtimeKitParticipantToken,
} from './realtimekit';
import {
  DDL,
  parseMember,
  parseMeta,
  type GameEventRow,
  type PlayerRow,
  type RoomMeta,
  type RoomMetaRow,
} from './schema';
import {
  activePlayers,
  isNameTaken,
  mergeConfig,
  sanitizeConfig,
  sanitizeName,
  sanitizeRoster,
  snapshot,
} from './room-helpers';

/** A viewer id guaranteed not to match any seat → projects the spectator view. */
const SPECTATOR_VIEWER = '__spectator__';
/** Sentinel actor name for an admin operator who holds no seat. */
const ADMIN_ANON = '__admin_someone__';

interface VoiceRevocationRow {
  [key: string]: SqlStorageValue;
  player_id: string;
  participant_id: string;
  meeting_id: string;
  attempts: number;
}

const ok = <T>(data?: T): Ack<T> => ({ ok: true, data });
const fail = <T = undefined>(code: string, message: string): Ack<T> => ({
  ok: false,
  error: { code, message },
});

/**
 * Authoritative single-room state, formerly an in-memory entry in the
 * process-global GameStore. Now one Durable Object instance per room code:
 * single-threaded (so the old persistChain race guard is gone), with its own
 * SQLite for the event log + room bookkeeping, and native WebSockets with the
 * Hibernation API in place of Socket.IO. The pure engine is unchanged.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private loaded = false;
  private meta: RoomMeta | null = null;
  private members = new Map<string, RoomMember>();
  private game: GameState | null = null;
  private eventSeq = 0;
  private voiceMeetingId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(DDL);
  }

  // ---------------------------------------------------------------------------
  // Load / rehydrate (runs lazily on the first call after each hibernation wake)
  // ---------------------------------------------------------------------------

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const rows = this.sql
      .exec<RoomMetaRow>(
        'SELECT code, host_token, status, config, game_id, seed, event_seq FROM room_meta WHERE id = 1',
      )
      .toArray();
    const row = rows[0];
    if (!row) {
      this.meta = null;
      return;
    }
    this.meta = parseMeta(row);
    this.eventSeq = row.event_seq;
    this.voiceMeetingId =
      this.sql
        .exec<{ meeting_id: string }>('SELECT meeting_id FROM voice_meeting WHERE id = 1')
        .toArray()[0]?.meeting_id ?? null;
    const playerRows = this.sql
      .exec<PlayerRow>('SELECT id, name, seat, is_spectator, claimed, connected FROM player')
      .toArray();
    this.members = new Map(playerRows.map((r) => [r.id, parseMember(r)]));
    // Reconcile each seat's live-connection flag with the sockets that survived
    // hibernation before serving any state.
    for (const m of this.members.values()) {
      const live = !!this.wsForPlayer(m.id);
      if (m.connected !== live) {
        m.connected = live;
        this.persistPlayer(m);
      }
    }
    if ((this.meta.status === 'in_game' || this.meta.status === 'finished') && this.meta.seed) {
      this.game = this.replayEvents(this.meta.seed, this.meta.config.options);
    }
  }

  /** Deterministically rebuild the engine state by replaying the event log. */
  private replayEvents(seed: string, options: GameOptions): GameState | null {
    const seated = activePlayers(this.members).map((m) => ({ id: m.id, name: m.name }));
    const created = createGame({ hostId: seated[0]?.id ?? '', players: seated, options, seed });
    if (!created.ok) return null;
    let state = created.state;
    const rows = this.sql
      .exec<GameEventRow>('SELECT seq, type, payload, created_at FROM game_event ORDER BY seq ASC')
      .toArray();
    for (const r of rows) {
      const event = JSON.parse(r.payload) as GameEvent;
      const ctx: EngineContext = { now: r.created_at, rng: createRng(`${seed}:${r.seq}`) };
      const result = reduce(state, event, ctx);
      if (!result.ok) break;
      state = result.state;
    }
    return state;
  }

  // ---------------------------------------------------------------------------
  // RPC methods (called from the Hono worker)
  // ---------------------------------------------------------------------------

  /** Create this room (idempotent). Returns the host token, or ok:false if the
   *  room already exists (code collision → caller retries with a new code). */
  async init(input: {
    code: string;
    roster?: string[];
    config?: Partial<RoomConfig>;
  }): Promise<
    | { ok: true; hostToken: string }
    | { ok: false; error: 'ROOM_EXISTS' | 'VOICE_UNAVAILABLE' }
  > {
    return this.ctx.blockConcurrencyWhile(async () => {
      this.ensureLoaded();
      if (this.meta) return { ok: false, error: 'ROOM_EXISTS' };
      const hostToken = makePlayerId();
      const roster = sanitizeRoster(input.roster ?? []);
      const config = mergeConfig(input.config, roster);
      let voiceMeetingId: string | null = null;
      if (config.voiceEnabled) {
        const credentials = getRealtimeKitCredentials(this.env);
        if (!credentials) return { ok: false, error: 'VOICE_UNAVAILABLE' };
        try {
          voiceMeetingId = await createRealtimeKitMeeting(
            credentials,
            `Avalon ${input.code}`,
          );
        } catch (error) {
          this.logRealtimeKitError('create meeting', error);
          return { ok: false, error: 'VOICE_UNAVAILABLE' };
        }
      }
      const seats: RoomMember[] = roster.map((name, i) => ({
        id: makePlayerId(),
        name,
        seat: i,
        isSpectator: false,
        connected: false,
        claimed: false,
      }));
      this.sql.exec(
        'INSERT INTO room_meta (id, code, host_token, status, config, game_id, seed, event_seq) VALUES (1, ?, ?, ?, ?, NULL, NULL, 0)',
        input.code,
        hostToken,
        'lobby',
        JSON.stringify(config),
      );
      for (const s of seats) this.persistPlayer(s);
      if (voiceMeetingId) {
        this.sql.exec('INSERT INTO voice_meeting (id, meeting_id) VALUES (1, ?)', voiceMeetingId);
      }
      this.meta = {
        code: input.code,
        hostToken,
        status: 'lobby',
        config,
        gameId: null,
        seed: null,
      };
      this.members = new Map(seats.map((s) => [s.id, s]));
      this.voiceMeetingId = voiceMeetingId;
      return { ok: true, hostToken };
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
    voiceEnabled: boolean;
  } | null> {
    this.ensureLoaded();
    if (!this.meta) return null;
    const seated = activePlayers(this.members);
    return {
      code: this.meta.code,
      status: this.meta.status,
      playerCount: seated.length,
      maxPlayers: this.meta.config.maxPlayers,
      allowSpectators: this.meta.config.allowSpectators,
      allowMidJoin: this.meta.config.allowMidJoin,
      voiceEnabled: this.meta.config.voiceEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle (Hibernation API)
  // ---------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...DEFAULT_ATTACHMENT });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let req: WireRequest;
    try {
      req = JSON.parse(message) as WireRequest;
    } catch {
      return;
    }
    if (req?.t !== 'req' || typeof req.id !== 'string') return;
    try {
      const res = await this.ctx.blockConcurrencyWhile(async () => {
        this.ensureLoaded();
        try {
          return await this.dispatch(ws, req.event, req.payload);
        } catch (error) {
          console.error('[room-do] handler error', error);
          return fail('INTERNAL', 'Internal error');
        }
      });
      this.sendAck(ws, req.id, res);
    } catch (e) {
      console.error('[room-do] handler error', e);
      this.sendAck(ws, req.id, fail('INTERNAL', 'Internal error'));
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.ensureLoaded();
      await this.handleDisconnect(ws);
    });
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    console.error('[room-do] ws error', error);
  }

  override async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.ensureLoaded();
      const pending = this.sql
        .exec<VoiceRevocationRow>(
          'SELECT player_id, participant_id, meeting_id, attempts FROM voice_revocation',
        )
        .toArray();
      for (const revocation of pending) await this.retryVoiceRevocation(revocation);
    });
  }

  private dispatch(
    ws: WebSocket,
    event: ClientEvent,
    payload: unknown,
  ): Promise<Ack<unknown>> | Ack<unknown> {
    switch (event) {
      case 'room:join':
        return this.handleJoin(ws, payload);
      case 'room:claimSeat':
        return this.handleClaimSeat(ws, payload);
      case 'room:releaseSeat':
        return this.handleReleaseSeat(ws);
      case 'room:setRoster':
        return this.handleSetRoster(ws, payload);
      case 'voice:token':
        return this.handleVoiceToken(ws);
      case 'room:config':
        return this.handleConfig(ws, payload);
      case 'room:rename':
        return this.handleRename(ws, payload);
      case 'room:kick':
        return this.handleKick(ws, payload);
      case 'room:transferHost':
        return fail('NOT_SUPPORTED', 'Host transfer is not available');
      case 'room:start':
        return this.handleStart(ws);
      case 'room:leave':
        return this.handleLeave(ws);
      case 'game:ackRole':
        return this.gameAction(ws, (pid) => ({ type: 'ACK_ROLE', by: pid }));
      case 'game:proposeTeam':
        return this.gameAction(ws, (pid) => ({
          type: 'PROPOSE_TEAM',
          by: pid,
          team: asStrArray((payload as { team?: unknown }).team),
        }));
      case 'game:vote':
        return this.gameAction(ws, (pid) => ({
          type: 'CAST_VOTE',
          by: pid,
          value: (payload as { value: 'approve' | 'reject' }).value,
        }));
      case 'game:missionCard':
        return this.gameAction(ws, (pid) => ({
          type: 'CAST_MISSION_CARD',
          by: pid,
          card: (payload as { card: 'success' | 'fail' }).card,
        }));
      case 'game:useLady':
        return this.gameAction(ws, (pid) => ({
          type: 'USE_LADY',
          by: pid,
          target: (payload as { targetPlayerId: string }).targetPlayerId,
        }));
      case 'game:assassinate':
        return this.gameAction(ws, (pid) => ({
          type: 'ASSASSINATE',
          by: pid,
          target: (payload as { targetPlayerId: string }).targetPlayerId,
        }));
      case 'net:ping':
        return this.handlePing(ws, payload);
      case 'admin:auth':
        return this.handleAdminAuth(ws);
      case 'admin:close':
        return this.handleAdminClose(ws);
      case 'admin:unbind':
        return this.handleAdminUnbind(ws, payload);
      case 'admin:vote':
        return this.handleAdminVote(ws, payload);
      case 'admin:propose':
        return this.handleAdminPropose(ws, payload);
      case 'admin:retractVotes':
        return this.handleAdminRetract(ws, 'votes');
      case 'admin:retractProposal':
        return this.handleAdminRetract(ws, 'proposal');
      default:
        return fail('UNKNOWN_EVENT', `Unknown event: ${String(event)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Room handlers (ported from handlers.ts)
  // ---------------------------------------------------------------------------

  private async handleJoin(
    ws: WebSocket,
    payload: unknown,
  ): Promise<Ack<{ playerId?: string; isHost: boolean }>> {
    if (!this.meta) return fail('ROOM_NOT_FOUND', 'Room not found');
    const { playerId, playerToken, hostToken } = (payload ?? {}) as {
      playerId?: string;
      playerToken?: string;
      hostToken?: string;
    };

    const isHost = !!hostToken && hostToken === this.meta.hostToken;
    this.setAttach(ws, { playerId: undefined, isHost });

    if (playerId && playerToken && this.members.has(playerId)) {
      const member = this.members.get(playerId)!;
      if (member.claimed && this.playerSessionToken(playerId) === playerToken) {
        // Supersede any stale socket still bound to this seat.
        const existing = this.wsForPlayer(playerId);
        if (existing && existing !== ws) this.setAttach(existing, { playerId: undefined });

        member.connected = true;
        this.persistPlayer(member);
        this.setAttach(ws, { playerId, isHost });
        if (this.game) await this.applyEvent({ type: 'SET_CONNECTED', by: playerId, connected: true });
        this.broadcastRoom();
        if (this.game) this.syncOne(playerId);
        return ok({ playerId, isHost });
      }
    }

    // Unseated → spectator view.
    this.broadcastRoom();
    if (this.game) this.syncSpectator(ws);
    return ok({ isHost });
  }

  private async handleClaimSeat(
    ws: WebSocket,
    payload: unknown,
  ): Promise<Ack<{ playerId: string; playerToken: string }>> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    const { seatId } = (payload ?? {}) as { seatId?: string };
    const target = seatId ? this.members.get(seatId) : undefined;
    if (!seatId || !target || target.isSpectator) return fail('UNKNOWN_SEAT', 'No such seat');
    const holder = this.wsForPlayer(seatId);
    if (target.claimed && holder !== ws) return fail('SEAT_TAKEN', 'That seat is already taken');

    const prevId = this.attach(ws).playerId;
    if (prevId && prevId !== seatId) {
      await this.revokeVoiceParticipant(prevId);
      this.releaseSeat(prevId);
      if (this.game) await this.applyEvent({ type: 'SET_CONNECTED', by: prevId, connected: false });
    }

    const playerToken = this.playerSessionToken(seatId) ?? makeSessionToken();
    this.persistPlayerSession(seatId, playerToken);
    target.claimed = true;
    target.connected = true;
    this.persistPlayer(target);
    this.setAttach(ws, { playerId: seatId });
    if (this.game) await this.applyEvent({ type: 'SET_CONNECTED', by: seatId, connected: true });
    this.broadcastRoom();
    if (this.game) this.syncOne(seatId);
    return ok({ playerId: seatId, playerToken });
  }

  private async handleReleaseSeat(ws: WebSocket): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    const pid = this.attach(ws).playerId;
    if (!pid) return ok();
    await this.revokeVoiceParticipant(pid);
    this.releaseSeat(pid);
    if (this.game) {
      await this.applyEvent({ type: 'SET_CONNECTED', by: pid, connected: false });
      this.syncSpectator(ws);
    }
    this.broadcastRoom();
    return ok();
  }

  private async handleSetRoster(ws: WebSocket, payload: unknown): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isHost) return fail('NOT_HOST', 'Only host');
    if (this.meta.status !== 'lobby') return fail('WRONG_PHASE', 'Game already started');
    const { names } = (payload ?? {}) as { names?: string[] };
    const res = await this.applyRoster(names ?? []);
    if (!res.ok) return res;
    this.broadcastRoom();
    return ok();
  }

  private handleConfig(ws: WebSocket, payload: unknown): Ack {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isHost) return fail('NOT_HOST', 'Only host');
    if (this.meta.status !== 'lobby') return fail('WRONG_PHASE', 'Game already started');
    const { config } = (payload ?? {}) as { config?: RoomConfig };
    if (!config) return fail('INVALID', 'No config');
    this.meta.config = sanitizeConfig(
      config,
      this.meta.config.roster,
      this.meta.config.voiceEnabled,
    );
    this.persistConfig();
    this.broadcastRoom();
    return ok();
  }

  private handleRename(ws: WebSocket, payload: unknown): Ack<{ name: string }> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    const pid = this.attach(ws).playerId;
    if (!pid) return fail('NOT_IN_ROOM', 'No player id');
    const member = this.members.get(pid);
    if (!member) return fail('UNKNOWN_PLAYER', 'No such player');
    const { name } = (payload ?? {}) as { name?: string };
    const desired = sanitizeName(name ?? '');
    if (!desired) return fail('INVALID_NAME', 'Name cannot be empty');
    if (isNameTaken(this.members, desired, pid)) {
      return fail('NAME_TAKEN', 'That name is already taken in this room');
    }
    member.name = desired;
    this.persistPlayer(member);
    this.broadcastRoom();
    return ok({ name: desired });
  }

  private async handleKick(ws: WebSocket, payload: unknown): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isHost) return fail('NOT_HOST', 'Only host');
    if (this.meta.status !== 'lobby') return fail('WRONG_PHASE', 'Cannot kick mid-game');
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: string };
    if (!targetPlayerId || !this.members.has(targetPlayerId)) {
      return fail('UNKNOWN_PLAYER', 'No such seat');
    }
    const targetWs = this.wsForPlayer(targetPlayerId);
    if (targetWs) this.send(targetWs, 'system:notice', { type: 'kicked', message: 'You were removed' });
    await this.revokeVoiceParticipant(targetPlayerId);
    this.releaseSeat(targetPlayerId);
    this.broadcastRoom();
    return ok();
  }

  private async handleStart(ws: WebSocket): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isHost) return fail('NOT_HOST', 'Only host');
    if (this.meta.status !== 'lobby') return fail('WRONG_PHASE', 'Already started');

    const seated = activePlayers(this.members);
    if (seated.length < 5 || seated.length > 10) {
      return fail('INVALID_PLAYER_COUNT', 'Need 5–10 roster seats to deal');
    }
    try {
      buildRoleSet(seated.length, this.meta.config.options);
    } catch (e) {
      return fail('INVALID_ROLE_SET', (e as Error).message);
    }

    const seed = `${this.meta.code}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const created = createGame({
      hostId: seated[0]!.id,
      players: seated.map((m) => ({ id: m.id, name: m.name })),
      options: this.meta.config.options,
      seed,
    });
    if (!created.ok) return fail(created.error.code, created.error.message);

    const gameId = makePlayerId();
    this.sql.exec('DELETE FROM game_event'); // fresh log for the new game
    this.game = created.state;
    this.meta.gameId = gameId;
    this.meta.seed = seed;
    this.eventSeq = 0;
    this.meta.status = 'in_game';
    this.sql.exec(
      'UPDATE room_meta SET game_id = ?, seed = ?, status = ?, event_seq = 0 WHERE id = 1',
      gameId,
      seed,
      'in_game',
    );

    const res = await this.applyEvent({ type: 'START_GAME', by: seated[0]!.id });
    if (!res.ok) return res;
    for (const m of seated) if (m.claimed) this.sendPrivateReveal(m.id);
    this.broadcastRoom();
    return ok();
  }

  // ---------------------------------------------------------------------------
  // Game actions & referee (admin) actions
  // ---------------------------------------------------------------------------

  private async gameAction(ws: WebSocket, build: (pid: string) => GameEvent): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    const pid = this.attach(ws).playerId;
    if (!pid) return fail('NOT_IN_ROOM', 'No player id');
    return this.applyEvent(build(pid));
  }

  private handlePing(ws: WebSocket, payload: unknown): Ack {
    if (!this.meta) return ok();
    const pid = this.attach(ws).playerId;
    const { rtt } = (payload ?? {}) as { rtt?: number };
    if (pid && typeof rtt === 'number' && Number.isFinite(rtt)) {
      const member = this.members.get(pid);
      if (member) {
        const clamped = Math.max(0, Math.min(9999, Math.round(rtt)));
        if (member.latency !== clamped) {
          member.latency = clamped; // transient; not persisted
          this.broadcastRoom();
          if (this.game) this.broadcastState();
        }
      }
    }
    return ok();
  }

  private async handleVoiceToken(
    ws: WebSocket,
  ): Promise<Ack<{ authToken: string }>> {
    if (!this.meta?.config.voiceEnabled || !this.voiceMeetingId) {
      return fail('VOICE_DISABLED', 'This room does not have voice enabled');
    }
    const playerId = this.attach(ws).playerId;
    const member = playerId ? this.members.get(playerId) : undefined;
    if (!playerId || !member?.claimed || this.wsForPlayer(playerId) !== ws) {
      return fail('SEAT_REQUIRED', 'Claim a seat before joining voice');
    }
    const credentials = getRealtimeKitCredentials(this.env);
    if (!credentials) return fail('VOICE_UNAVAILABLE', 'Voice is temporarily unavailable');

    try {
      const pendingRevocation = this.voiceRevocation(playerId);
      if (pendingRevocation && !(await this.retryVoiceRevocation(pendingRevocation))) {
        return fail('VOICE_UNAVAILABLE', 'Voice is temporarily unavailable');
      }
      const existingParticipantId = this.voiceParticipantId(playerId);
      if (existingParticipantId) {
        try {
          const authToken = await refreshRealtimeKitParticipantToken(
            credentials,
            this.voiceMeetingId,
            existingParticipantId,
          );
          return ok({ authToken });
        } catch (error) {
          if (!(error instanceof RealtimeKitApiError) || error.status !== 404) throw error;
          this.deleteVoiceParticipantRecord(playerId);
        }
      }

      const participant = await addRealtimeKitParticipant(
        credentials,
        this.voiceMeetingId,
        playerId,
        member.name,
      );
      this.persistVoiceParticipant(playerId, participant.participantId);
      return ok({ authToken: participant.authToken });
    } catch (error) {
      this.logRealtimeKitError('issue participant token', error);
      return fail('VOICE_UNAVAILABLE', 'Voice is temporarily unavailable');
    }
  }

  private handleAdminAuth(ws: WebSocket): Ack<{ ok: boolean }> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    this.setAttach(ws, { isAdmin: true });
    if (this.game) this.pushAdminLog('admin.panelOpened', { actor: this.adminActorName(ws) });
    return ok({ ok: true });
  }

  private handleAdminClose(ws: WebSocket): Ack {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isAdmin) return ok();
    this.setAttach(ws, { isAdmin: false });
    if (this.game) this.pushAdminLog('admin.panelClosed', { actor: this.adminActorName(ws) });
    return ok();
  }

  private async handleAdminUnbind(ws: WebSocket, payload: unknown): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isAdmin) return fail('NOT_ADMIN', 'Referee panel not enabled');
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: string };
    const target = targetPlayerId ? this.members.get(targetPlayerId) : undefined;
    if (!targetPlayerId || !target || target.isSpectator) return fail('UNKNOWN_PLAYER', 'No such seat');

    const actor = this.adminActorName(ws);
    const targetName = target.name;
    const targetWs = this.wsForPlayer(targetPlayerId);
    await this.revokeVoiceParticipant(targetPlayerId);
    this.releaseSeat(targetPlayerId);
    if (targetWs) {
      this.send(targetWs, 'system:notice', { type: 'unbound', message: 'You were unbound by a referee' });
    }
    if (this.game) await this.applyEvent({ type: 'SET_CONNECTED', by: targetPlayerId, connected: false });
    this.pushAdminLog('admin.unbound', { actor, target: targetName });
    this.broadcastRoom();
    if (this.game && targetWs) this.syncSpectator(targetWs);
    return ok();
  }

  private async handleAdminVote(ws: WebSocket, payload: unknown): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isAdmin) return fail('NOT_ADMIN', 'Referee panel not enabled');
    const { targetPlayerId, value } = (payload ?? {}) as {
      targetPlayerId?: string;
      value?: 'approve' | 'reject';
    };
    const target = targetPlayerId ? this.members.get(targetPlayerId) : undefined;
    if (!targetPlayerId || !target || target.isSpectator) return fail('UNKNOWN_PLAYER', 'No such player');
    if (value !== 'approve' && value !== 'reject') return fail('INVALID', 'Invalid vote');
    const res = await this.applyEvent({ type: 'CAST_VOTE', by: targetPlayerId, value, admin: true });
    if (!res.ok) return res;
    this.pushAdminLog('admin.votedFor', { actor: this.adminActorName(ws), target: target.name, value });
    return ok();
  }

  private async handleAdminPropose(ws: WebSocket, payload: unknown): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isAdmin) return fail('NOT_ADMIN', 'Referee panel not enabled');
    if (!this.game) return fail('NO_GAME', 'No game in progress');
    if (this.game.phase !== 'TeamBuilding') return fail('WRONG_PHASE', 'Not in TeamBuilding');
    const { team } = (payload ?? {}) as { team?: unknown };
    const leader = leaderId(this.game);
    const res = await this.applyEvent({
      type: 'PROPOSE_TEAM',
      by: leader,
      team: asStrArray(team),
      admin: true,
    });
    if (!res.ok) return res;
    const leaderName = this.members.get(leader)?.name ?? leader;
    this.pushAdminLog('admin.proposedFor', { actor: this.adminActorName(ws), leader: leaderName });
    return ok();
  }

  private async handleAdminRetract(ws: WebSocket, which: 'votes' | 'proposal'): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    if (!this.attach(ws).isAdmin) return fail('NOT_ADMIN', 'Referee panel not enabled');
    if (!this.game) return fail('NO_GAME', 'No game in progress');
    const res = await this.applyEvent(
      which === 'votes' ? { type: 'RETRACT_VOTES' } : { type: 'RETRACT_PROPOSAL' },
    );
    if (!res.ok) return res;
    this.pushAdminLog(
      which === 'votes' ? 'admin.votesRetracted' : 'admin.proposalRetracted',
      { actor: this.adminActorName(ws) },
    );
    return ok();
  }

  // ---------------------------------------------------------------------------
  // Leave / disconnect
  // ---------------------------------------------------------------------------

  private async handleLeave(ws: WebSocket): Promise<Ack> {
    if (!this.meta) return ok();
    const pid = this.attach(ws).playerId;
    if (!pid) {
      this.broadcastRoom();
      return ok();
    }
    await this.revokeVoiceParticipant(pid);
    this.releaseSeat(pid);
    if (this.game) await this.applyEvent({ type: 'SET_CONNECTED', by: pid, connected: false });
    this.broadcastRoom();
    return ok();
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    if (!this.meta) return;
    const pid = this.attach(ws).playerId;
    if (!pid) return;
    // Superseded by a reconnect on another socket → this close is stale.
    const superseded = this.ctx.getWebSockets().some((w) => w !== ws && this.attach(w).playerId === pid);
    if (superseded) return;

    const member = this.members.get(pid);
    if (this.meta.status === 'lobby') {
      // Lobby drop: free the seat so someone else can claim it.
      await this.revokeVoiceParticipant(pid);
      this.releaseSeat(pid);
      this.broadcastRoom();
    } else {
      // Mid-game drop: keep the seat claimed, just mark offline (allow reconnect).
      if (member) {
        member.connected = false;
        this.persistPlayer(member);
      }
      if (this.game) await this.applyEvent({ type: 'SET_CONNECTED', by: pid, connected: false });
      this.broadcastRoom();
    }
  }

  // ---------------------------------------------------------------------------
  // Engine application + projection + broadcast (ported from runtime.ts)
  // ---------------------------------------------------------------------------

  private async applyEvent(event: GameEvent): Promise<Ack> {
    if (!this.game || !this.meta || !this.meta.seed) return fail('NO_GAME', 'No game in progress');
    const prevState = this.game;
    const seq = this.eventSeq + 1;
    const ctx: EngineContext = { now: Date.now(), rng: createRng(`${this.meta.seed}:${seq}`) };
    const result = reduce(prevState, event, ctx);
    if (!result.ok) return fail(result.error.code, result.error.message);

    this.game = result.state;
    this.eventSeq = seq;
    // Single-threaded DO → persist synchronously (no persistChain needed).
    this.sql.exec(
      'INSERT INTO game_event (seq, type, payload, created_at) VALUES (?, ?, ?, ?)',
      seq,
      event.type,
      JSON.stringify(event),
      ctx.now,
    );
    this.sql.exec('UPDATE room_meta SET event_seq = ? WHERE id = 1', seq);

    for (const effect of result.effects) {
      if (effect.kind === 'PRIVATE_LADY') {
        const w = this.wsForPlayer(effect.holderId);
        if (w) this.send(w, 'private:lady', { targetId: effect.targetId, loyalty: effect.loyalty });
      } else if (effect.kind === 'PERSIST_CHECKPOINT') {
        if (effect.checkpoint === 'game_started') this.setStatus('in_game');
        else if (effect.checkpoint === 'game_over') {
          this.setStatus('finished');
          await this.archiveReplay();
        }
      }
    }

    this.broadcastState();
    return ok();
  }

  /** On game over, build the immutable ReplayData and ship it to the ReplayDO
   *  (keyed by gameId), then this room needs no replay tables at all. */
  private async archiveReplay(): Promise<void> {
    if (!this.meta?.gameId || !this.meta.seed) return;
    const seated = activePlayers(this.members).map((m) => ({ id: m.id, name: m.name }));
    const rows = this.sql
      .exec<GameEventRow>('SELECT seq, type, payload, created_at FROM game_event ORDER BY seq ASC')
      .toArray();
    const events = rows.map((r) => ({
      seq: r.seq,
      event: JSON.parse(r.payload) as GameEvent,
      createdAt: r.created_at,
    }));
    const replay = buildReplayFromEvents(
      this.meta.gameId,
      this.meta.seed,
      this.meta.config.options,
      seated,
      events,
    );
    if (!replay) return;
    const stub = this.env.REPLAY.get(this.env.REPLAY.idFromName(this.meta.gameId));
    await stub.store(replay);
  }

  private project(playerId: string): ClientGameState {
    const view = projectStateForViewer(this.game!, playerId);
    view.gameId = this.meta?.gameId ?? null;
    for (const p of view.players) {
      const member = this.members.get(p.id);
      if (!member) continue;
      if (member.latency !== undefined) p.latency = member.latency;
      p.claimed = member.claimed;
    }
    return view;
  }

  private broadcastState(): void {
    if (!this.game) return;
    let spectatorView: ClientGameState | null = null;
    for (const w of this.ctx.getWebSockets()) {
      const pid = this.attach(w).playerId;
      if (pid && this.members.has(pid)) {
        this.send(w, 'state:sync', this.project(pid));
      } else {
        if (!spectatorView) spectatorView = this.project(SPECTATOR_VIEWER);
        this.send(w, 'state:sync', spectatorView);
      }
    }
  }

  private broadcastRoom(): void {
    if (!this.meta) return;
    const snap = snapshot(this.meta, this.members, this.currentHostPlayerId());
    for (const w of this.ctx.getWebSockets()) this.send(w, 'room:snapshot', snap);
  }

  private sendPrivateReveal(playerId: string): void {
    if (!this.game) return;
    const view = projectStateForViewer(this.game, playerId);
    if (view.selfRole) {
      const w = this.wsForPlayer(playerId);
      if (w) this.send(w, 'private:reveal', { selfRole: view.selfRole, knownPlayers: view.knownPlayers });
    }
  }

  private syncOne(playerId: string): void {
    if (!this.game) return;
    const w = this.wsForPlayer(playerId);
    if (w) this.send(w, 'state:sync', this.project(playerId));
  }

  private syncSpectator(ws: WebSocket): void {
    if (!this.game) return;
    this.send(ws, 'state:sync', this.project(SPECTATOR_VIEWER));
  }

  private pushAdminLog(key: string, params: Record<string, string | number>): void {
    if (!this.game) return;
    this.game.logSeq += 1;
    this.game.logs.push({
      seq: this.game.logSeq,
      roundIndex: this.game.roundIndex,
      at: Date.now(),
      channel: 'public',
      key,
      params,
      style: 'admin',
    });
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Roster reconciliation (ported from handlers.applyRoster)
  // ---------------------------------------------------------------------------

  private async applyRoster(names: string[]): Promise<Ack> {
    if (!this.meta) return fail('NOT_IN_ROOM', 'Not in a room');
    const desired = names.slice(0, 10).map((n, i) => sanitizeName(n) || fallbackSeatName(i));
    const seats = activePlayers(this.members);
    // Refuse to drop a claimed seat.
    for (let i = desired.length; i < seats.length; i++) {
      if (seats[i]!.claimed) return fail('SEAT_CLAIMED', 'Cannot remove a claimed seat');
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
      await this.revokeVoiceParticipant(seat.id);
      this.members.delete(seat.id);
      this.deletePlayer(seat.id);
    }
    this.meta.config.roster = desired;
    this.persistConfig();
    return ok();
  }

  // ---------------------------------------------------------------------------
  // WebSocket / attachment helpers (replace socket.data + socketByPlayer)
  // ---------------------------------------------------------------------------

  private attach(ws: WebSocket): SocketAttachment {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? { ...DEFAULT_ATTACHMENT };
  }

  private setAttach(ws: WebSocket, patch: Partial<SocketAttachment>): void {
    ws.serializeAttachment({ ...this.attach(ws), ...patch });
  }

  private wsForPlayer(pid: string): WebSocket | undefined {
    for (const w of this.ctx.getWebSockets()) {
      if (this.attach(w).playerId === pid) return w;
    }
    return undefined;
  }

  private currentHostPlayerId(): string | null {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.attach(ws);
      if (attachment.isHost && attachment.playerId) return attachment.playerId;
    }
    return null;
  }

  /** Mark a seat unclaimed + offline and drop its socket binding. Seat stays. */
  private releaseSeat(playerId: string): void {
    const member = this.members.get(playerId);
    if (member) {
      member.claimed = false;
      member.connected = false;
      this.persistPlayer(member);
    }
    this.deletePlayerSession(playerId);
    const holder = this.wsForPlayer(playerId);
    if (holder) this.setAttach(holder, { playerId: undefined });
  }

  private async revokeVoiceParticipant(playerId: string): Promise<void> {
    const participantId = this.voiceParticipantId(playerId);
    if (!participantId || !this.voiceMeetingId) return;
    const revocation: VoiceRevocationRow = {
      player_id: playerId,
      participant_id: participantId,
      meeting_id: this.voiceMeetingId,
      attempts: 0,
    };
    this.persistVoiceRevocation(revocation);
    await this.scheduleVoiceRevocationRetry(revocation.attempts);
    await this.retryVoiceRevocation(revocation);
  }

  private async retryVoiceRevocation(revocation: VoiceRevocationRow): Promise<boolean> {
    const credentials = getRealtimeKitCredentials(this.env);
    if (!credentials) {
      await this.recordVoiceRevocationFailure(revocation);
      return false;
    }
    try {
      await deleteRealtimeKitParticipant(
        credentials,
        revocation.meeting_id,
        revocation.participant_id,
      );
    } catch (error) {
      if (error instanceof RealtimeKitApiError && error.status === 404) {
        this.completeVoiceRevocation(revocation);
        return true;
      }
      this.logRealtimeKitError('delete participant', error);
      await this.recordVoiceRevocationFailure(revocation);
      return false;
    }
    this.completeVoiceRevocation(revocation);
    return true;
  }

  private async recordVoiceRevocationFailure(revocation: VoiceRevocationRow): Promise<void> {
    revocation.attempts += 1;
    this.persistVoiceRevocation(revocation);
    await this.scheduleVoiceRevocationRetry(revocation.attempts);
  }

  private async scheduleVoiceRevocationRetry(attempts: number): Promise<void> {
    const delay = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(attempts, 4));
    const now = Date.now();
    const scheduled = now + delay;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current <= now || current > scheduled) {
      await this.ctx.storage.setAlarm(scheduled);
    }
  }

  private logRealtimeKitError(action: string, error: unknown): void {
    const detail =
      error instanceof RealtimeKitApiError ? `HTTP ${error.status}` : 'unexpected error';
    console.error(`[room-do] RealtimeKit ${action} failed: ${detail}`);
  }

  private adminActorName(ws: WebSocket): string {
    const pid = this.attach(ws).playerId;
    const member = pid ? this.members.get(pid) : undefined;
    return member?.name ?? ADMIN_ANON;
  }

  private send(ws: WebSocket, event: string, payload: unknown): void {
    try {
      ws.send(JSON.stringify({ t: 'push', event, payload }));
    } catch {
      /* socket closing; drop the push */
    }
  }

  private sendAck(ws: WebSocket, id: string, res: Ack<unknown>): void {
    try {
      ws.send(JSON.stringify({ t: 'ack', id, res }));
    } catch {
      /* socket closing; drop the ack */
    }
  }

  // ---------------------------------------------------------------------------
  // SQLite persistence helpers
  // ---------------------------------------------------------------------------

  private setStatus(status: RoomStatus): void {
    if (!this.meta) return;
    this.meta.status = status;
    this.sql.exec('UPDATE room_meta SET status = ? WHERE id = 1', status);
  }

  private persistConfig(): void {
    if (!this.meta) return;
    this.sql.exec('UPDATE room_meta SET config = ? WHERE id = 1', JSON.stringify(this.meta.config));
  }

  private persistPlayer(m: RoomMember): void {
    this.sql.exec(
      `INSERT INTO player (id, name, seat, is_spectator, claimed, connected)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, seat=excluded.seat, is_spectator=excluded.is_spectator,
         claimed=excluded.claimed, connected=excluded.connected`,
      m.id,
      m.name,
      m.seat,
      m.isSpectator ? 1 : 0,
      m.claimed ? 1 : 0,
      m.connected ? 1 : 0,
    );
  }

  private playerSessionToken(playerId: string): string | null {
    return (
      this.sql
        .exec<{ token: string }>('SELECT token FROM player_session WHERE player_id = ?', playerId)
        .toArray()[0]?.token ?? null
    );
  }

  private persistPlayerSession(playerId: string, token: string): void {
    this.sql.exec(
      `INSERT INTO player_session (player_id, token) VALUES (?, ?)
       ON CONFLICT(player_id) DO UPDATE SET token=excluded.token`,
      playerId,
      token,
    );
  }

  private deletePlayerSession(playerId: string): void {
    this.sql.exec('DELETE FROM player_session WHERE player_id = ?', playerId);
  }

  private voiceParticipantId(playerId: string): string | null {
    return (
      this.sql
        .exec<{ participant_id: string }>(
          'SELECT participant_id FROM voice_participant WHERE player_id = ?',
          playerId,
        )
        .toArray()[0]?.participant_id ?? null
    );
  }

  private voiceRevocation(playerId: string): VoiceRevocationRow | null {
    return (
      this.sql
        .exec<VoiceRevocationRow>(
          `SELECT player_id, participant_id, meeting_id, attempts
           FROM voice_revocation WHERE player_id = ?`,
          playerId,
        )
        .toArray()[0] ?? null
    );
  }

  private persistVoiceParticipant(playerId: string, participantId: string): void {
    this.sql.exec(
      `INSERT INTO voice_participant (player_id, participant_id) VALUES (?, ?)
       ON CONFLICT(player_id) DO UPDATE SET participant_id=excluded.participant_id`,
      playerId,
      participantId,
    );
  }

  private deleteVoiceParticipantRecord(playerId: string): void {
    this.sql.exec('DELETE FROM voice_participant WHERE player_id = ?', playerId);
  }

  private persistVoiceRevocation(revocation: VoiceRevocationRow): void {
    this.sql.exec(
      `INSERT INTO voice_revocation (player_id, participant_id, meeting_id, attempts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         participant_id=excluded.participant_id,
         meeting_id=excluded.meeting_id,
         attempts=excluded.attempts`,
      revocation.player_id,
      revocation.participant_id,
      revocation.meeting_id,
      revocation.attempts,
    );
  }

  private completeVoiceRevocation(revocation: VoiceRevocationRow): void {
    this.sql.exec(
      'DELETE FROM voice_revocation WHERE player_id = ? AND participant_id = ?',
      revocation.player_id,
      revocation.participant_id,
    );
    this.sql.exec(
      'DELETE FROM voice_participant WHERE player_id = ? AND participant_id = ?',
      revocation.player_id,
      revocation.participant_id,
    );
  }

  private deletePlayer(id: string): void {
    this.sql.exec('DELETE FROM player WHERE id = ?', id);
    this.deletePlayerSession(id);
    if (!this.voiceRevocation(id)) this.deleteVoiceParticipantRecord(id);
  }
}

/** Coerce an unknown wire value to a string[] (team payloads). */
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
