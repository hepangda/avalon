import { leaderId, type GameEvent, type GameState } from '@/lib/engine';
import type { Ack, RoomMember } from '@/lib/socket/types';
import type { RoomSocket, SocketAttachment } from './env';
import type { RoomMeta } from './persistence';
import { asStrArray, fail, ok } from './room-result';

interface RefereeContext {
  readonly meta: RoomMeta | null;
  readonly game: GameState | null;
  readonly members: Map<string, RoomMember>;
  attach(ws: RoomSocket): SocketAttachment;
  setAttach(ws: RoomSocket, patch: Partial<SocketAttachment>): void;
  pushAdminLog(key: string, params: Record<string, string | number>): void;
  releaseSeat(id: string): void;
  wsForPlayer(id: string): RoomSocket | undefined;
  send(ws: RoomSocket, event: string, payload: unknown): void;
  applyEvent(event: GameEvent): Promise<Ack>;
  broadcastRoom(): void;
  syncSpectator(ws: RoomSocket): void;
}

/** Called only inside Room's serial transaction; never commits or sends independently. */
export class RefereeCommands {
  constructor(private readonly room: RefereeContext) { }
  handleAdminAuth(ws: RoomSocket): Ack<{ ok: boolean }> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    this.room.setAttach(ws, { isAdmin: true });
    if (this.room.game)
      this.room.pushAdminLog("admin.panelOpened", {
        actor: this.adminActorName(ws),
      });
    return ok({ ok: true });
  }

  handleAdminClose(ws: RoomSocket): Ack {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin) return ok();
    this.room.setAttach(ws, { isAdmin: false });
    if (this.room.game)
      this.room.pushAdminLog("admin.panelClosed", {
        actor: this.adminActorName(ws),
      });
    return ok();
  }

  async handleAdminUnbind(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: string };
    const target = targetPlayerId
      ? this.room.members.get(targetPlayerId)
      : undefined;
    if (!targetPlayerId || !target || target.isSpectator)
      return fail("UNKNOWN_PLAYER", "No such seat");

    const actor = this.adminActorName(ws);
    const targetName = target.name;
    const targetWs = this.room.wsForPlayer(targetPlayerId);
    this.room.releaseSeat(targetPlayerId);
    if (targetWs) {
      this.room.send(targetWs, "system:notice", {
        type: "unbound",
        message: "You were unbound by a referee",
      });
    }
    if (this.room.game)
      await this.room.applyEvent({
        type: "SET_CONNECTED",
        by: targetPlayerId,
        connected: false,
      });
    this.room.pushAdminLog("admin.unbound", { actor, target: targetName });
    this.room.broadcastRoom();
    if (this.room.game && targetWs) this.room.syncSpectator(targetWs);
    return ok();
  }

  async handleAdminVote(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { targetPlayerId, value } = (payload ?? {}) as {
      targetPlayerId?: string;
      value?: "approve" | "reject";
    };
    const target = targetPlayerId
      ? this.room.members.get(targetPlayerId)
      : undefined;
    if (!targetPlayerId || !target || target.isSpectator)
      return fail("UNKNOWN_PLAYER", "No such player");
    if (value !== "approve" && value !== "reject")
      return fail("INVALID", "Invalid vote");
    const res = await this.room.applyEvent({
      type: "CAST_VOTE",
      by: targetPlayerId,
      value,
      admin: true,
    });
    if (!res.ok) return res;
    this.room.pushAdminLog("admin.votedFor", {
      actor: this.adminActorName(ws),
      target: target.name,
      value,
    });
    return ok();
  }

  async handleAdminPropose(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    if (!this.room.game) return fail("NO_GAME", "No game in progress");
    if (
      this.room.game.phase !== "TeamBuilding" &&
      this.room.game.phase !== "TeamFinalizing"
    )
      return fail("WRONG_PHASE", "Not choosing a team");
    const { team } = (payload ?? {}) as { team?: unknown };
    const leader = leaderId(this.room.game);
    const res = await this.room.applyEvent({
      type:
        this.room.game.phase === "TeamFinalizing" ? "FINALIZE_TEAM" : "PROPOSE_TEAM",
      by: leader,
      team: asStrArray(team),
      admin: true,
    });
    if (!res.ok) return res;
    const leaderName = this.room.members.get(leader)?.name ?? leader;
    this.room.pushAdminLog("admin.proposedFor", {
      actor: this.adminActorName(ws),
      leader: leaderName,
    });
    return ok();
  }

  async handleAdminRetract(
    ws: RoomSocket,
    which: "votes" | "proposal",
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    if (!this.room.game) return fail("NO_GAME", "No game in progress");
    const res = await this.room.applyEvent(
      which === "votes"
        ? { type: "RETRACT_VOTES" }
        : { type: "RETRACT_PROPOSAL" },
    );
    if (!res.ok) return res;
    this.room.pushAdminLog(
      which === "votes" ? "admin.votesRetracted" : "admin.proposalRetracted",
      { actor: this.adminActorName(ws) },
    );
    return ok();
  }

  async handleAdminPhase(
    ws: RoomSocket,
    action: "assassination" | "previous",
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    if (!this.room.game) return fail("NO_GAME", "No game in progress");
    const actor = this.adminActorName(ws);
    const res = await this.room.applyEvent(
      action === "previous"
        ? { type: "PREVIOUS_PHASE", actor }
        : {
          type: "START_ASSASSINATION",
          by: this.room.game.assassinId ?? "",
          admin: true,
          actor,
        },
    );
    if (res.ok) this.room.broadcastRoom();
    return res;
  }

  async handleAdminSetTimersPaused(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { paused } = (payload ?? {}) as { paused?: unknown };
    if (typeof paused !== "boolean")
      return fail("INVALID", "Invalid timer state");
    return this.room.applyEvent({
      type: "SET_TIMERS_PAUSED",
      paused,
      actor: this.adminActorName(ws),
    });
  }

  async handleAdminSkipSpeech(
    ws: RoomSocket,
    payload: unknown,
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    const { targetPlayerId } = (payload ?? {}) as { targetPlayerId?: unknown };
    if (typeof targetPlayerId !== "string" || !targetPlayerId)
      return fail("INVALID", "Missing speaker");
    return this.room.applyEvent({
      type: "SKIP_SPEECH",
      target: targetPlayerId,
      actor: this.adminActorName(ws),
    });
  }

  async handleAdminReroll(
    ws: RoomSocket,
    type: "REROLL_LEADER" | "REROLL_ROLES",
  ): Promise<Ack> {
    if (!this.room.meta) return fail("NOT_IN_ROOM", "Not in a room");
    if (!this.room.attach(ws).isAdmin)
      return fail("NOT_ADMIN", "Referee panel not enabled");
    return this.room.applyEvent({ type, actor: this.adminActorName(ws) });
  }

  private adminActorName(ws: RoomSocket): string {
    const pid = this.room.attach(ws).playerId;
    const member = pid ? this.room.members.get(pid) : undefined;
    return member?.name ?? "__admin_someone__";
  }

}
