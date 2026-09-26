import { afterEach, expect, it, vi } from 'vitest';
import type { Ack } from '../types';
import { createLatencyHeartbeat } from './heartbeat';

afterEach(() => vi.restoreAllMocks());

function sample() {
  let resolve!: (ack: Ack) => void;
  const promise = new Promise<Ack>((done) => { resolve = done; });
  return { promise, resolve };
}

it('allows only one in-flight sample and reports the last successful RTT', async () => {
  const first = sample();
  const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
  const publish = vi.fn();
  const now = vi.spyOn(performance, 'now').mockReturnValue(100);
  const heartbeat = createLatencyHeartbeat(send, publish);
  const pending = heartbeat.ping();
  await heartbeat.ping();
  expect(send).toHaveBeenCalledTimes(1);
  now.mockReturnValue(350);
  first.resolve({ ok: true });
  await pending;
  expect(publish).toHaveBeenLastCalledWith(250);
  await heartbeat.ping();
  expect(send).toHaveBeenLastCalledWith(250);
});

it('does not display or report a timeout as a successful ten-second RTT', async () => {
  const first = sample();
  const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
  const publish = vi.fn();
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  const heartbeat = createLatencyHeartbeat(send, publish);
  const pending = heartbeat.ping();
  now.mockReturnValue(10000);
  first.resolve({ ok: false, error: { code: 'TIMEOUT', message: 'Timed out' } });
  await pending;
  expect(publish).toHaveBeenCalledExactlyOnceWith(null);
  await heartbeat.ping();
  expect(send).toHaveBeenLastCalledWith(undefined);
});

it('ignores a stale reply after reconnect without releasing the new pending sample', async () => {
  const old = sample();
  const fresh = sample();
  const send = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const publish = vi.fn();
  const heartbeat = createLatencyHeartbeat(send, publish);
  const oldPing = heartbeat.ping();
  heartbeat.reset();
  const freshPing = heartbeat.ping();
  old.resolve({ ok: true });
  await oldPing;
  expect(publish).not.toHaveBeenCalled();
  await heartbeat.ping();
  expect(send).toHaveBeenCalledTimes(2);
  fresh.resolve({ ok: true });
  await freshPing;
  expect(publish).toHaveBeenCalledTimes(1);
});

it('does not publish or send after leaving the room', async () => {
  const first = sample();
  const send = vi.fn().mockReturnValue(first.promise);
  const publish = vi.fn();
  const heartbeat = createLatencyHeartbeat(send, publish);
  const pending = heartbeat.ping();
  heartbeat.dispose();
  first.resolve({ ok: true });
  await pending;
  await heartbeat.ping();
  expect(publish).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});

it('recovers after a send failure', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('Socket closed')).mockResolvedValue({ ok: true });
  const publish = vi.fn();
  const heartbeat = createLatencyHeartbeat(send, publish);
  await heartbeat.ping();
  expect(publish).toHaveBeenLastCalledWith(null);
  await heartbeat.ping();
  expect(send).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith(expect.any(Number));
});
