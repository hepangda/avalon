import {
  projectStateForViewer,
  type ClientGameState
} from "@/lib/engine";
import { viewContent, type RoomView, type ViewSnapshot } from '@/lib/socket/stateIntegrity';
import { randomUUID } from 'node:crypto';
import {
  type RoomSocket,
  type SocketAttachment
} from "./env";
import {
  snapshot
} from "./room-helpers";
import { documentHash } from './room-journal';
import { RoomState } from './room-state';
interface ViewContext {
  readonly state: RoomState; readonly sockets: Set<RoomSocket>; readonly latencies: Map<string, number>;
  readonly reconnectOnly: WeakSet<RoomSocket>; attach(ws: RoomSocket): SocketAttachment;
}
/** Per-viewer committed snapshots and digests; called only after persistence succeeds. */
export class RoomViews {
  private readonly epoch = randomUUID();
  private reliableSockets = new WeakSet<RoomSocket>();
  private committedViews = new WeakMap<RoomSocket, ViewSnapshot>();
  private committedAttachments = new WeakMap<RoomSocket, SocketAttachment>();
  dirty = false;
  private viewRevision = 0;
  private forceViews = new WeakSet<RoomSocket>();
  constructor(private readonly context: ViewContext) { }
  enable(ws: RoomSocket) { this.reliableSockets.add(ws); this.forceViews.add(ws); }
  isReliable(ws: RoomSocket) { return this.reliableSockets.has(ws); }
  get(ws: RoomSocket) { return this.committedViews.get(ws); }
  attachment(ws: RoomSocket) { return this.committedAttachments.get(ws); }
  invalidate() { this.committedViews = new WeakMap(); }
  commitAttachments() {
    for (const ws of this.context.sockets) this.committedAttachments.set(ws, structuredClone(this.context.attach(ws)));
  }
  private sendImmediate(ws: RoomSocket, event: string, payload: unknown) {
    try { ws.send(JSON.stringify({ t: 'push', event, payload })); } catch { /* closed socket */ }
  }


  project(playerId: string): ClientGameState {
    const view = projectStateForViewer(this.context.state.game!, playerId);
    view.serverTime = Date.now();
    view.gameId = this.context.state.meta?.gameId ?? null;
    for (const p of view.players) {
      const member = this.context.state.members.get(p.id);
      // Presence comes from the live room, not engine defaults or replayed events.
      p.claimed = member?.claimed ?? false;
      p.connected = !!(member?.claimed && member.connected);
      if (!member) continue;
      p.isBot = member.isBot;
      p.name = member.name;
      const latency = this.context.latencies.get(p.id);
      if (latency !== undefined) p.latency = latency;
      p.avatarUrl = member.avatarUrl;
    }
    return view;
  }


  currentHostPlayerId(): string | null {
    for (const ws of [...this.context.sockets]) {
      const attachment = this.context.attach(ws);
      if (attachment.isHost && attachment.playerId) return attachment.playerId;
    }
    return null;
  }


  roomSnapshot() {
    const result = snapshot(this.context.state.meta!, this.context.state.members, this.currentHostPlayerId());
    return {
      ...result, members: result.members.map((member) => ({
        ...member,
        ...(this.context.latencies.has(member.id) ? { latency: this.context.latencies.get(member.id) } : {}),
      }))
    };
  }


  publish(): void {
    if (!this.context.state.meta) return;
    const room = this.roomSnapshot();
    for (const ws of this.context.sockets) {
      if (!this.reliableSockets.has(ws) || this.context.reconnectOnly.has(ws)) continue;
      const attachment = this.context.attach(ws);
      const view: RoomView = {
        room, game: this.context.state.game ? this.project(attachment.playerId ?? '__spectator__') : null,
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


  sendView(ws: RoomSocket, committed: ViewSnapshot, recovery = false): void {
    this.sendImmediate(ws, 'view:sync', {
      ...committed, recovery, view: {
        ...committed.view, game: committed.view.game ? { ...committed.view.game, serverTime: Date.now() } : null,
      }
    });
  }
}
