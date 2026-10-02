import type { Ack } from '../types';
import type { ClientEvent, EventPayload, EventAck, ServerMessage, WireRequest } from '../protocol';

/**
 * Per-room WebSocket connection. One native
 * WebSocket is opened to `/rooms/{code}/ws`, which the Node server routes to that
 * room's in-memory instance. Requests are correlated to acks by an incrementing id;
 * unsolicited server pushes are dispatched to the registered handler.
 */

export type ConnState = 'connecting' | 'connected' | 'disconnected';

export interface RoomHandlers {
  onState?: (s: ConnState) => void;
  onPush?: (event: string, payload: unknown) => void;
}

const ACK_TIMEOUT_MS = 10000;
const RECONNECT_MIN = 500;
const RECONNECT_MAX = 4000;

class RoomConnection {
  readonly code: string;
  private ws: WebSocket | null = null;
  private handlers: RoomHandlers = {};
  private pending = new Map<string, { resolve: (r: Ack<unknown>) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  setHandlers(h: RoomHandlers): void {
    this.handlers = h;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    const s = this.ws?.readyState;
    if (s === WebSocket.OPEN || s === WebSocket.CONNECTING) return;
    this.closedByUser = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/rooms/${this.code}/ws`;
    this.handlers.onState?.('connecting');

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempts = 0;
      this.handlers.onState?.('connected');
    };
    ws.onmessage = (ev) => { if (this.ws === ws) this.onMessage(ev.data); };
    ws.onerror = () => {
      /* the close event fires next and drives reconnect */
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      if (event.code === 4001) this.closedByUser = true;
      this.rejectAllPending();
      this.handlers.onState?.('disconnected');
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /** Send an action and resolve with its ack (never rejects; failures become
   *  `{ ok:false, error }` acks so callers can branch uniformly). */
  emit<R>(event: ClientEvent, payload: unknown): Promise<Ack<R>> {
    return new Promise<Ack<R>>((resolve) => {
      if (!this.connected) {
        resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Not connected' } });
        return;
      }
      const id = String(++this.seq);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: { code: 'TIMEOUT', message: 'Socket request timed out' } });
      }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (r: Ack<unknown>) => void, timer });
      const req: WireRequest = { t: 'req', id, event, payload };
      this.ws!.send(JSON.stringify(req));
    });
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === 'ack') {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg.res);
      }
    } else if (msg.t === 'push') {
      this.handlers.onPush?.(msg.event, msg.payload);
    }
  }

  private rejectAllPending(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Connection closed' } });
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX, RECONNECT_MIN * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

let current: RoomConnection | null = null;

/** Open (or reuse) the single active room connection for `code`. */
export function connectRoom(code: string, handlers: RoomHandlers): RoomConnection {
  if (current && current.code !== code) {
    current.close();
    current = null;
  }
  if (!current) current = new RoomConnection(code);
  current.setHandlers(handlers);
  current.connect();
  return current;
}

export function getConnection(): RoomConnection | null {
  return current;
}

/** End the authenticated connection when its account is no longer active. */
export function disconnectRoom(): void {
  current?.setHandlers({});
  current?.close();
  current = null;
}

/** Typed request wrapper for the active room connection. */
export function emitWithAck<E extends ClientEvent>(event: E, payload: EventPayload<E>): Promise<EventAck<E>> {
  if (!current) {
    return Promise.resolve({
      ok: false,
      error: { code: 'NO_ROOM', message: 'Not connected to a room' },
    } as EventAck<E>);
  }
  return current.emit(event, payload) as Promise<EventAck<E>>;
}
