import { expect, it, vi } from 'vitest';
import type { Ack } from '../types';
import { createSyncHeartbeat } from './heartbeat';

function sample() {
  let resolve!: (ack: Ack) => void;
  const promise = new Promise<Ack>((done) => { resolve = done; });
  return { promise, resolve };
}

it('checks integrity without reporting application response time as RTT', async () => {
  const first = sample();
  const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
  const onAck = vi.fn();
  const heartbeat = createSyncHeartbeat(send, onAck);
  const pending = heartbeat.ping();
  await heartbeat.ping();
  expect(send).toHaveBeenCalledTimes(1);
  first.resolve({ ok: true });
  await pending;
  expect(onAck).toHaveBeenCalledWith({ ok: true });
  await heartbeat.ping();
  expect(send).toHaveBeenLastCalledWith();
});

it('ignores a stale reply after reconnect without releasing the new pending request', async () => {
  const old = sample();
  const fresh = sample();
  const send = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const onAck = vi.fn();
  const heartbeat = createSyncHeartbeat(send, onAck);
  const oldPing = heartbeat.ping();
  heartbeat.reset();
  const freshPing = heartbeat.ping();
  old.resolve({ ok: true });
  await oldPing;
  expect(onAck).not.toHaveBeenCalled();
  await heartbeat.ping();
  expect(send).toHaveBeenCalledTimes(2);
  fresh.resolve({ ok: true });
  await freshPing;
  expect(onAck).toHaveBeenCalledTimes(1);
});

it('does not publish or send after leaving the room', async () => {
  const first = sample();
  const send = vi.fn().mockReturnValue(first.promise);
  const onAck = vi.fn();
  const heartbeat = createSyncHeartbeat(send, onAck);
  const pending = heartbeat.ping();
  heartbeat.dispose();
  first.resolve({ ok: true });
  await pending;
  await heartbeat.ping();
  expect(onAck).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});

it('recovers after a send failure or timeout', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('Socket closed'))
    .mockResolvedValueOnce({ ok: false, error: { code: 'TIMEOUT', message: 'Timed out' } })
    .mockResolvedValue({ ok: true });
  const onAck = vi.fn();
  const heartbeat = createSyncHeartbeat(send, onAck);
  await heartbeat.ping();
  expect(onAck).not.toHaveBeenCalled();
  await heartbeat.ping();
  await heartbeat.ping();
  expect(send).toHaveBeenCalledTimes(3);
  expect(onAck).toHaveBeenLastCalledWith({ ok: true });
});
