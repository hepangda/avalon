import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomHarness, Socket } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('empty lobby dissolution', () => {
  it.each(['room:leave', 'room:releaseSeat', 'room:kick'])('deletes a bot-only lobby after %s and notifies spectators', async (event) => {
    const h = roomHarness();
    await h.action(h.host, 'room:details', { name: 'Table', visibility: 'public' });
    await h.action(h.host, 'room:addBot');
    for (const player of h.sockets.slice(1, -1)) await h.action(player, 'room:leave');
    expect(await h.room.preview()).not.toBeNull();
    expect((await h.action(h.host, event, { targetPlayerId: 'p0' })).ok).toBe(true);
    expect(await h.persistence.loadRoom('1234')).toBeNull();
    expect((await h.persistence.listPublicRooms(1)).rooms).toEqual([]);
    expect(await h.room.preview()).toBeNull();
    expect(h.spectator.messages).toContainEqual({ t: 'push', event: 'system:notice', payload: { type: 'room_dissolved' } });
    h.wake();
    const newcomer = new Socket({ account: 'new', isHost: false, isAdmin: false });
    expect((await h.action(newcomer, 'room:join')).error?.code).toBe('ROOM_NOT_FOUND');
  });

  it('preserves disconnected human seats for reconnecting', async () => {
    const h = roomHarness();
    for (const player of h.sockets.slice(1, -1)) await h.action(player, 'room:leave');
    await h.room.webSocketClose(h.host);
    expect(await h.room.preview()).not.toBeNull();
    expect(h.document.members.find((member) => member.id === 'p0')).toMatchObject({ claimed: true, connected: false });
  });

  it('dissolves a started game when the last human host leaves', async () => {
    const h = roomHarness();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    for (const player of h.sockets.slice(0, -1)) await h.action(player, 'room:leave');
    expect(await h.room.preview()).toBeNull();
  });

  it('does not dissolve during a seat change', async () => {
    const h = roomHarness();
    for (const player of h.sockets.slice(1, -1)) await h.action(player, 'room:leave');
    expect((await h.action(h.host, 'room:claimSeat', { seatId: 'p1' })).ok).toBe(true);
    expect((await h.room.preview())?.playerCount).toBe(1);
  });

  it('does not publish dissolution when deletion fails', async () => {
    const h = roomHarness();
    for (const player of h.sockets.slice(1, -1)) await h.action(player, 'room:leave');
    const before = structuredClone(h.document);
    vi.spyOn(h.persistence, 'deleteRoom').mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.action(h.host, 'room:leave')).ok).toBe(false);
    expect(h.document).toEqual(before);
    expect(h.spectator.messages.some((message) => message.event === 'system:notice')).toBe(false);
    h.wake();
    expect(await h.room.preview()).not.toBeNull();
  });
});
