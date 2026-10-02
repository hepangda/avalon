import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('account device handoff', () => {
  it('restores the creator seat and host on a fresh browser and retires the previous device', async () => {
    const h = roomHarness(false);
    const created = await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    expect(created.ok).toBe(true);
    await h.action(h.host, 'room:join');
    const next = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    const joined = await h.action(next, 'room:join');
    expect(joined).toMatchObject({ ok: true, data: { playerId: h.document.members[0]!.id, isHost: true } });
    expect(h.host.close).toHaveBeenCalledWith(4001, expect.any(String));
    expect(h.host.deserializeAttachment()).toMatchObject({ playerId: undefined, isHost: false, isAdmin: false });
    expect((await h.action(h.host, 'room:join')).error?.code).toBe('RECONNECT');
    await h.room.webSocketClose(h.host);
    expect(h.document.members[0]).toMatchObject({ claimed: true, connected: true });
    expect((await h.action(next, 'room:rename', { name: 'Alice again' })).ok).toBe(true);
  });

  it('retains the lobby seat after disconnect and restores it after runtime recreation', async () => {
    const h = roomHarness(false);
    await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    await h.action(h.host, 'room:join');
    const id = h.document.members[0]!.id;
    await h.room.webSocketClose(h.host);
    expect(h.document.members[0]).toMatchObject({ id, claimed: true, connected: false });
    h.sockets.splice(0);
    h.wake();
    const next = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect(await h.action(next, 'room:join')).toMatchObject({ ok: true, data: { playerId: id, isHost: true } });
    await h.action(next, 'room:leave');
    expect((await h.action(next, 'room:join')).data).not.toHaveProperty('playerId');
  });

  it('does not let another account reuse seat or host tokens', async () => {
    const h = roomHarness(false);
    const created = await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    expect(await h.action(h.spectator, 'room:join', created)).toEqual({ ok: true, data: { isHost: false } });
    expect(h.document.accounts).toEqual({ [h.document.members[0]!.id]: 'account-0' });
  });

  it('does not publish a takeover when persistence fails', async () => {
    const h = roomHarness(false);
    await h.room.init({ code: '1234', creator: { name: 'Alice', account: 'account-0' } });
    await h.action(h.host, 'room:join');
    await h.room.webSocketClose(h.host);
    h.room.addSocket(h.host);
    h.host.messages = [];
    h.save.mockRejectedValueOnce(new Error('save failed'));
    vi.spyOn(console, 'error').mockImplementation(() => { });
    const next = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect((await h.action(next, 'room:join')).ok).toBe(false);
    expect(h.host.close).not.toHaveBeenCalledWith(4001, expect.any(String));
    expect(h.host.messages.some((message) => message.event === 'system:notice')).toBe(false);
  });
});
