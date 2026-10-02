import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectRoom, disconnectRoom } from './socket';

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  close() { this.readyState = 3; }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'https:', host: 'avalon.test' });
});

afterEach(() => {
  disconnectRoom();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('stops reconnecting after another device takes over, even without a notice', () => {
  const onState = vi.fn();
  connectRoom('1234', { onState });
  FakeWebSocket.instances[0]!.serverClose(4001);
  vi.advanceTimersByTime(30_000);
  expect(onState).toHaveBeenLastCalledWith('disconnected');
  expect(FakeWebSocket.instances).toHaveLength(1);
});

it('still reconnects after an ordinary network disconnect', () => {
  connectRoom('1234', {});
  FakeWebSocket.instances[0]!.serverClose(1006);
  vi.advanceTimersByTime(500);
  expect(FakeWebSocket.instances).toHaveLength(2);
  expect(FakeWebSocket.instances[1]!.url).toBe('wss://avalon.test/rooms/1234/ws');
});

it('ignores events from a retired socket after a replacement connects', () => {
  const onPush = vi.fn(); const onState = vi.fn();
  connectRoom('1234', { onPush, onState });
  const old = FakeWebSocket.instances[0]!;
  old.serverClose(1006);
  vi.advanceTimersByTime(500);
  const current = FakeWebSocket.instances[1]!;
  current.readyState = FakeWebSocket.OPEN; current.onopen?.();
  onState.mockClear();
  old.onmessage?.({ data: JSON.stringify({ t: 'push', event: 'view:sync', payload: {} }) });
  old.serverClose(4001);
  expect(onPush).not.toHaveBeenCalled(); expect(onState).not.toHaveBeenCalled();
});
