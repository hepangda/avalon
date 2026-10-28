import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomRegistry } from './rooms';
import { roomHarness, Socket } from './test-room';

const MINUTE = 60_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('room presence deadlines and host succession', () => {
  it.each([false, true])('transfers the host immediately on departure (started: %s)', async (started) => {
    const h = roomHarness();
    if (started) await h.action(h.host, 'room:start');
    const successor = h.document.members.filter((member) => member.claimed && member.id !== 'p0').sort((a, b) => a.seat - b.seat)[0]!;
    const next = h.sockets.find((socket) => socket.deserializeAttachment().playerId === successor.id)!;
    const nextAccount = next.deserializeAttachment().account!;
    expect((await h.action(h.host, 'room:leave')).ok).toBe(true);
    expect(next.deserializeAttachment().isHost).toBe(true);
    expect(h.host.deserializeAttachment().isHost).toBe(false);
    expect(h.document.meta.hostAccount).toBe(nextAccount);
    expect(h.spectator.snapshot.hostPlayerId).toBe(successor.id);
    expect((await h.action(h.host, 'room:config', { config: h.document.meta.config })).error?.code).toBe('NOT_HOST');
    expect((await h.action(next, 'room:details', { name: 'New host', visibility: 'public' })).ok).toBe(true);
    h.wake();
    const returned = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect(await h.action(returned, 'room:join', { hostToken: 'host-secret' })).toMatchObject({ data: { isHost: false } });
    expect(await h.action(next, 'room:join')).toMatchObject({ data: { playerId: successor.id, isHost: true } });
  });

  it('transfers after five uninterrupted offline minutes and preserves the old seat', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    await h.room.webSocketClose(h.host);
    const since = h.document.meta.hostOfflineSince;
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(h.sockets[1]!.deserializeAttachment().isHost).toBe(false);
    await h.action(h.spectator, 'room:join');
    expect(h.document.meta.hostOfflineSince).toBe(since);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets[1]!.deserializeAttachment().isHost).toBe(true);
    expect(h.document.members.find((m) => m.id === 'p0')?.claimed).toBe(true);
    const returned = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect(await h.action(returned, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' }))
      .toMatchObject({ data: { playerId: 'p0', isHost: false } });
  });

  it('restarts the host grace period after a successful reconnect', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    await h.room.webSocketClose(h.host);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    await h.action(h.host, 'room:join');
    expect(h.document.meta.hostOfflineSince).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(h.host.deserializeAttachment().isHost).toBe(true);
    await h.room.webSocketClose(h.host);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(h.sockets[1]!.deserializeAttachment().isHost).toBe(true);
  });

  it.each([false, true])('uses the room phase deadline when only bots, spectators and offline humans remain (started: %s)', async (started) => {
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    if (started) await h.action(h.host, 'room:start');
    for (const player of h.sockets.slice(0, -1)) await h.room.webSocketClose(player);
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(await h.room.preview()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    if (started) {
      expect(await h.room.preview()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(55 * MINUTE - 1);
      expect(await h.room.preview()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(await h.room.preview()).toBeNull();
    expect(await h.persistence.loadRoom('1234')).toBeNull();
    expect(h.spectator.messages).toContainEqual({ t: 'push', event: 'system:notice', payload: { type: 'room_dissolved' } });
  });

  it('dissolves immediately when the host leaves and every other human is offline', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    for (const player of h.sockets.slice(1, -1)) await h.room.webSocketClose(player);
    expect((await h.action(h.host, 'room:leave')).ok).toBe(true);
    expect(await h.room.preview()).toBeNull();
  });

  it('ignores spectators and bots for the sixty-minute started-game deadline', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    await h.action(h.host, 'room:start');
    // The host remains online as a spectator, so the five-minute host rule does not fire.
    await h.action(h.host, 'room:releaseSeat');
    for (const player of h.sockets.slice(1, -1)) await h.room.webSocketClose(player);
    const since = h.document.meta.allHumansOfflineSince;
    await vi.advanceTimersByTimeAsync(60 * MINUTE - 1);
    expect(await h.room.preview()).not.toBeNull();
    expect(h.document.meta.allHumansOfflineSince).toBe(since);
    await vi.advanceTimersByTimeAsync(1);
    expect(await h.room.preview()).toBeNull();
  });

  it.each([false, true])('resets the all-player deadline when any human reconnects (started: %s)', async (started) => {
    const h = roomHarness();
    if (started) await h.action(h.host, 'room:start');
    const beforeDeadline = (started ? 59 : 9) * MINUTE;
    await h.action(h.host, 'room:releaseSeat');
    for (const player of h.sockets.slice(1, -1)) await h.room.webSocketClose(player);
    await vi.advanceTimersByTimeAsync(beforeDeadline);
    const player = h.sockets[1]!;
    await h.action(player, 'room:join', { playerId: 'p2', playerToken: 'token-2' });
    expect(h.document.meta.allHumansOfflineSince).toBeUndefined();
    await h.room.webSocketClose(player);
    await vi.advanceTimersByTimeAsync(beforeDeadline);
    expect(await h.room.preview()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(await h.room.preview()).toBeNull();
  });

  it('transfers the host when a human returns after five minutes in an unattended started game', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    for (const player of h.sockets.slice(0, -1)) await h.room.webSocketClose(player);
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    expect(await h.room.preview()).not.toBeNull();
    const next = h.sockets[1]!;
    await h.action(next, 'room:join', { playerId: 'p2', playerToken: 'token-2' });
    expect(next.deserializeAttachment().isHost).toBe(true);
    expect(h.document.meta.allHumansOfflineSince).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(await h.room.preview()).not.toBeNull();
  });

  it('skips an offline human and a bot when selecting the new host', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    await h.room.webSocketClose(h.sockets[1]!);
    await h.action(h.host, 'room:leave');
    expect(h.document.meta.hostAccount).toBe('account-3');
    expect(h.sockets[2]!.deserializeAttachment().isHost).toBe(true);
  });

  it('retains deadlines across runtime recreation and does not evict rooms awaiting them', async () => {
    const h = roomHarness();
    await h.room.webSocketClose(h.host);
    h.sockets.splice(0, 1);
    const since = h.document.meta.hostOfflineSince;
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    h.wake();
    await h.room.maintainPresence();
    expect(h.document.meta.hostOfflineSince).toBe(since);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(h.sockets[0]!.deserializeAttachment().isHost).toBe(true);
  });

  it('restores unattended rooms on startup and cleans them without any new requests', async () => {
    const h = roomHarness();
    for (const player of h.sockets.slice(0, -1)) await h.room.webSocketClose(player);
    h.room.stop();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    const registry = new RoomRegistry(h.persistence);
    await registry.restore();
    const restored = registry.get('1234');
    expect(restored.idle).toBe(false);
    registry.evictIdle(0);
    expect(registry.get('1234')).toBe(restored);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(await h.persistence.loadRoom('1234')).toBeNull();
    await registry.drain();
  });

  it('counts graceful shutdown downtime toward the host deadline', async () => {
    const h = roomHarness();
    await h.action(h.spectator, 'room:join');
    await h.room.shutdown();
    const since = h.document.meta.hostOfflineSince;
    await vi.advanceTimersByTimeAsync(6 * MINUTE);
    const registry = new RoomRegistry(h.persistence);
    await registry.restore();
    expect(since).toBeDefined();
    expect(await h.persistence.loadRoom('1234')).toBeNull();
    await registry.drain();
  });

  it('expires a room before a late join can clear a persisted deadline', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    for (const player of h.sockets.slice(0, -1)) await h.room.webSocketClose(player);
    h.room.stop();
    h.sockets.splice(0);
    await vi.advanceTimersByTimeAsync(6 * MINUTE);
    h.wake();
    const returning = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect((await h.action(returning, 'room:join')).error?.code).toBe('ROOM_NOT_FOUND');
    expect(await h.persistence.loadRoom('1234')).toBeNull();
  });

  it('publishes the new host to reliable clients after the ownership commit', async () => {
    const h = roomHarness();
    const next = h.sockets[1]!;
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    await h.action(next, 'room:join', { playerId: 'p2', playerToken: 'token-2' });
    await h.action(h.host, 'room:leave');
    const view = next.messages.filter((message) => message.event === 'view:sync').at(-1)!.payload;
    expect(view).toMatchObject({ view: { isHost: true, playerId: 'p2', room: { hostPlayerId: 'p2' } } });
  });

  it('rolls back a failed transfer and retries the expired timer without a new client request', async () => {
    const h = roomHarness();
    await h.room.webSocketClose(h.host);
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(h.sockets[1]!.deserializeAttachment().isHost).toBe(false);
    expect(h.document.meta.hostAccount).not.toBe('account-2');
    // Existing connections were quarantined after the failed commit. With no online
    // candidates, the retried maintenance should now dissolve the room.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await h.persistence.loadRoom('1234')).toBeNull();
  });
});
