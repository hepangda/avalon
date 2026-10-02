import {
  type GameEvent
} from "@/lib/engine";
import { fallbackSeatName } from "@/lib/game/names";
import { resolveRoomConfig } from '@/lib/socket/roomConfig';
import type {
  Ack,
  RoomConfig,
  RoomMember
} from "@/lib/socket/types";
import {
  type RoomSocket,
  type SocketAttachment
} from "./env";
import { makePlayerId, makeSessionToken } from "./ids";
import {
  activePlayers,
  isNameTaken,
  restoreSeatIdentity,
  sanitizeAvatarUrl,
  sanitizeConfig,
  sanitizeName
} from "./room-helpers";
import { fail, ok } from './room-result';
import { RoomState } from './room-state';
interface MembershipEffects {
  readonly latencies: Map<string, number>;
  readonly sockets: Set<RoomSocket>;
  attach(ws: RoomSocket): SocketAttachment;
  setAttach(ws: RoomSocket, patch: Partial<SocketAttachment>): void;
  send(ws: RoomSocket, event: string, payload: unknown): void;
  wsForPlayer(id: string): RoomSocket | undefined;
  applyEvent(event: GameEvent): Promise<Ack>;
  broadcastRoom(): void;
  syncOne(id: string): void;
  syncSpectator(ws: RoomSocket): void;
  negotiateView(ws: RoomSocket): void;
  retireAfterCommit(ws: RoomSocket): void;
}
/** Seat/account changes and lobby commands execute within the caller's transaction. */
export class RoomMembership {
  constructor(private readonly state: RoomState, private readonly effects: MembershipEffects) { }


  async handleJoin(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack<{ playerId?: string; playerToken?: string; isHost: boolean }>> {
    if (!this.state.meta) return fail("ROOM_NOT_FOUND", "Room not found");
    const { playerId, playerToken, hostToken } = (payload ?? {}) as {
      playerId?: string;
      playerToken?: string;
      hostToken?: string;
    };

    if ((payload as { syncVersion?: number } | null)?.syncVersion === 1) {
      this.effects.negotiateView(ws);
    }
    const account = this.effects.attach(ws).account!;
    // Account ownership takes precedence over browser-local reconnect tokens.
    const ownedSeat = [...this.state.members.values()].find(
      (member) => member.claimed && this.state.accounts[member.id] === account,
    );
    const legacySeat = playerId && playerToken &&
      !this.state.accounts[playerId] && this.playerSessionToken(playerId) === playerToken
      ? this.state.members.get(playerId) : undefined;
    const member = ownedSeat ?? (legacySeat?.claimed ? legacySeat : undefined);
    const isHost = this.state.meta.hostAccount
      ? this.state.meta.hostAccount === account
      : !!hostToken && hostToken === this.state.meta.hostToken;
    if (isHost) this.state.meta.hostAccount = account;
    this.effects.setAttach(ws, { playerId: undefined, isHost });

    // Retire old devices only after the new binding has committed successfully.
    for (const existing of this.effects.sockets) {
      if (existing === ws) continue;
      const attachment = this.effects.attach(existing);
      if (attachment.account !== account && (!member || attachment.playerId !== member.id)) continue;
      this.effects.setAttach(existing, { playerId: undefined, isHost: false, isAdmin: false });
      this.effects.send(existing, "system:notice", { type: "session_replaced" });
      if (this.state.game) this.effects.syncSpectator(existing);
      this.effects.retireAfterCommit(existing);
    }

    if (member) {
      const playerId = member.id;
      const playerToken = this.playerSessionToken(playerId) ?? makeSessionToken();
      this.persistPlayerSession(playerId, playerToken);
      member.connected = true;
      this.persistPlayer(member);
      this.effects.setAttach(ws, { playerId, isHost });
      this.bindAccount(ws, playerId);
      if (this.state.game)
        await this.effects.applyEvent({ type: "SET_CONNECTED", by: playerId, connected: true });
      this.effects.broadcastRoom();
      if (this.state.game) this.effects.syncOne(playerId);
      return ok({ playerId, playerToken, isHost });
    }

    // Unseated → spectator view.
    this.effects.broadcastRoom();
    if (this.state.game) this.effects.syncSpectator(ws);
    return ok({ isHost });
  }


  handleAddBot(ws: RoomSocket): Ack {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.effects.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "lobby") return fail("WRONG_PHASE", "Game already started");
    const seats = activePlayers(this.state.members);
    let target = seats.find((member) => !member.claimed);
    if (!target) {
      if (seats.length >= 10) return fail("ROOM_FULL", "All 10 seats are taken");
      target = { id: makePlayerId(), name: '', seat: seats.length, isSpectator: false, claimed: false, connected: false };
      this.state.meta.config.roster.push(fallbackSeatName(target.seat));
    }
    let number = 1;
    while (isNameTaken(this.state.members, `Bot ${number}`, target.id)) number++;
    target.name = `Bot ${number}`;
    target.isBot = true;
    target.claimed = true;
    target.connected = true;
    delete target.avatarUrl;
    delete target.latency;
    this.persistPlayer(target);
    this.effects.broadcastRoom();
    return ok();
  }


  async handleClaimSeat(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack<{ playerId: string; playerToken: string }>> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const { seatId: requestedSeatId, name, avatarUrl } = (payload ?? {}) as {
      seatId?: string;
      name?: unknown;
      avatarUrl?: unknown;
    };
    const prevId = this.effects.attach(ws).playerId;
    const automatic = requestedSeatId === undefined;
    if (automatic && this.state.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Choose an existing seat during a game");
    const seats = activePlayers(this.state.members);
    let target = requestedSeatId ? this.state.members.get(requestedSeatId) : undefined;
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
    const holder = this.effects.wsForPlayer(seatId);
    if (target.claimed && holder !== ws)
      return fail("SEAT_TAKEN", "That seat is already taken");

    const account = this.effects.attach(ws).account;
    if (account && seats.some((member) => member.claimed && member.id !== prevId && member.id !== seatId && this.state.accounts[member.id] === account))
      return fail("ALREADY_SEATED", "This account already has a seat in the room");
    const desiredName = typeof name === "string" ? sanitizeName(name) : "";
    const desiredAvatarUrl = sanitizeAvatarUrl(avatarUrl);
    if ((automatic || name !== undefined) && !desiredName)
      return fail("INVALID_NAME", "Name cannot be empty");
    if (
      desiredName &&
      [...this.state.members.values()].some(
        (member) =>
          member.id !== seatId &&
          member.id !== prevId &&
          member.claimed &&
          member.name.toLowerCase() === desiredName.toLowerCase(),
      )
    ) {
      return fail("NAME_TAKEN", "That name is already taken in this room");
    }
    if (!this.state.members.has(seatId)) {
      this.state.meta.config.roster.push(fallbackSeatName(target.seat));
    }
    if (prevId && prevId !== seatId) {
      this.releaseSeat(prevId);
      if (this.state.game)
        await this.effects.applyEvent({
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
    this.effects.setAttach(ws, { playerId: seatId });
    this.bindAccount(ws, seatId);
    if (this.state.game)
      await this.effects.applyEvent({
        type: "SET_CONNECTED",
        by: seatId,
        connected: true,
      });
    this.effects.broadcastRoom();
    if (this.state.game) this.effects.syncOne(seatId);
    return ok({ playerId: seatId, playerToken });
  }


  async handleReleaseSeat(ws: RoomSocket): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const pid = this.effects.attach(ws).playerId;
    if (!pid) return ok();
    this.releaseSeat(pid);
    if (this.state.game) {
      await this.effects.applyEvent({
        type: "SET_CONNECTED",
        by: pid,
        connected: false,
      });
      this.effects.syncSpectator(ws);
    }
    this.effects.broadcastRoom();
    return ok();
  }


  async handleSetRoster(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.effects.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Game already started");
    const { names } = (payload ?? {}) as { names?: string[] };
    const res = await this.applyRoster(names ?? []);
    if (!res.ok) return res;
    this.effects.broadcastRoom();
    return ok();
  }


  handleConfig(ws: RoomSocket, payload: unknown): Ack {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.effects.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Game already started");
    const { config } = (payload ?? {}) as { config?: RoomConfig };
    if (!config) return fail("INVALID", "No config");
    this.state.meta.config = resolveRoomConfig(
      sanitizeConfig(config, this.state.meta.config.roster),
      activePlayers(this.state.members).filter((member) => member.claimed).length,
    );
    this.effects.broadcastRoom();
    return ok();
  }


  handleRemoveSeat(ws: RoomSocket, payload: unknown): Ack {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.effects.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Game already started");
    const { seatId } = (payload ?? {}) as { seatId?: string };
    const target = seatId ? this.state.members.get(seatId) : undefined;
    if (!target || target.isSpectator)
      return fail("UNKNOWN_SEAT", "No such seat");
    if (target.claimed)
      return fail("SEAT_CLAIMED", "Cannot remove a claimed seat");
    const seats = activePlayers(this.state.members);
    if (seats.length <= 1)
      return fail("INVALID_PLAYER_COUNT", "Keep at least one seat");

    const remaining = seats
      .filter((seat) => seat.id !== target.id)
      .map((seat, index) => ({ ...seat, seat: index }));
    const roster = this.state.meta.config.roster.filter(
      (_, index) => index !== target.seat,
    );
    const config = { ...this.state.meta.config, roster };
    this.deletePlayer(target.id);
    for (const seat of remaining) this.persistPlayer(seat);
    this.state.members.delete(target.id);
    for (const seat of remaining) this.state.members.set(seat.id, seat);
    this.state.meta.config = config;
    this.effects.broadcastRoom();
    return ok();
  }


  handleRename(
    ws: RoomSocket,
    payload: unknown,
  ): Ack<{ name: string }> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const pid = this.effects.attach(ws).playerId;
    if (!pid) return fail("NOT_IN_ROOM", "No player id");
    const member = this.state.members.get(pid);
    if (!member) return fail("UNKNOWN_PLAYER", "No such player");
    const { name } = (payload ?? {}) as { name?: string };
    const desired = sanitizeName(name ?? "");
    if (!desired) return fail("INVALID_NAME", "Name cannot be empty");
    if (isNameTaken(this.state.members, desired, pid)) {
      return fail("NAME_TAKEN", "That name is already taken in this room");
    }
    member.name = desired;
    this.persistPlayer(member);
    this.effects.broadcastRoom();
    return ok({ name: desired });
  }


  async handleKick(ws: RoomSocket, payload: unknown): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.effects.attach(ws).isHost) return fail("NOT_HOST", "Only host");
    if (this.state.meta.status !== "lobby")
      return fail("WRONG_PHASE", "Cannot kick mid-game");
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: string };
    if (!targetPlayerId || !this.state.members.has(targetPlayerId)) {
      return fail("UNKNOWN_PLAYER", "No such seat");
    }
    const targetWs = this.effects.wsForPlayer(targetPlayerId);
    if (targetWs)
      this.effects.send(targetWs, "system:notice", {
        type: "kicked",
        message: "You were removed",
      });
    this.releaseSeat(targetPlayerId);
    this.effects.broadcastRoom();
    return ok();
  }


  // ---------------------------------------------------------------------------
  // Game actions & referee (admin) actions
  // ---------------------------------------------------------------------------

  bindAccount(ws: RoomSocket, playerId: string): void {
    const account = this.effects.attach(ws).account;
    if (this.state.gameAccounts[playerId] && this.state.gameAccounts[playerId] !== account)
      delete this.state.gameAccounts[playerId];
    if (account) {
      this.state.accounts[playerId] = account;
      const seat = this.state.game?.players.find((player) => player.id === playerId)?.seat;
      // A replacement or a player changing seats mid-game must also move next game.
      if (seat !== undefined) this.state.lastGameSeats.byAccount[account] = seat;
    }
    else delete this.state.accounts[playerId];
  }


  // ---------------------------------------------------------------------------
  // Leave / disconnect
  // ---------------------------------------------------------------------------

  async handleLeave(ws: RoomSocket): Promise<Ack> {
    if (!this.state.meta) return ok();
    const pid = this.effects.attach(ws).playerId;
    if (!pid) {
      this.effects.broadcastRoom();
      return ok();
    }
    this.releaseSeat(pid);
    if (this.state.game)
      await this.effects.applyEvent({
        type: "SET_CONNECTED",
        by: pid,
        connected: false,
      });
    this.effects.broadcastRoom();
    return ok();
  }


  async handleDisconnect(ws: RoomSocket): Promise<void> {
    if (!this.state.meta) return;
    const pid = this.effects.attach(ws).playerId;
    if (!pid) return;
    // Superseded by a reconnect on another socket → this close is stale.
    const superseded = [...this.effects.sockets].some(
      (w) => w !== ws && this.effects.attach(w).playerId === pid,
    );
    if (superseded) return;

    const member = this.state.members.get(pid);
    // A transport disconnect is not an explicit departure: retain account ownership.
    if (member) {
      member.connected = false;
      delete member.latency;
      this.effects.latencies.delete(pid);
      this.persistPlayer(member);
    }
    if (this.state.game)
      await this.effects.applyEvent({ type: "SET_CONNECTED", by: pid, connected: false });
    this.effects.broadcastRoom();
  }


  // ---------------------------------------------------------------------------
  // Roster reconciliation
  // ---------------------------------------------------------------------------

  async applyRoster(names: string[]): Promise<Ack> {
    if (!this.state.meta) return fail("NOT_IN_ROOM", "Not in a room");
    const desired = names
      .slice(0, 10)
      .map((n, i) => sanitizeName(n) || fallbackSeatName(i));
    const seats = activePlayers(this.state.members);
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
      this.state.members.set(member.id, member);
      this.persistPlayer(member);
    }
    // Drop trailing unclaimed seats.
    for (let i = desired.length; i < seats.length; i++) {
      const seat = seats[i]!;
      this.state.members.delete(seat.id);
      this.deletePlayer(seat.id);
    }
    this.state.meta.config.roster = desired;
    return ok();
  }


  /** Release a seat, restoring its roster identity before dropping the binding. */
  releaseSeat(playerId: string): void {
    delete this.state.accounts[playerId];
    delete this.state.gameAccounts[playerId];
    const member = this.state.members.get(playerId);
    if (member) {
      restoreSeatIdentity(member, this.state.meta?.config.roster ?? []);
      delete member.isBot;
      member.claimed = false;
      member.connected = false;
      this.persistPlayer(member);
    }
    this.deletePlayerSession(playerId);
    const holder = this.effects.wsForPlayer(playerId);
    if (holder) this.effects.setAttach(holder, { playerId: undefined });
  }


  persistPlayer(member: RoomMember): void {
    this.state.members.set(member.id, member);
  }


  playerSessionToken(playerId: string): string | null {
    return this.state.sessions[playerId] ?? null;
  }


  persistPlayerSession(playerId: string, token: string): void {
    this.state.sessions[playerId] = token;
  }


  deletePlayerSession(playerId: string): void {
    delete this.state.sessions[playerId];
  }


  deletePlayer(id: string): void {
    this.state.members.delete(id);
    this.deletePlayerSession(id);
  }
}
