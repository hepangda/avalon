import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomHarness, Socket } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('manual host transfer', () => {
  it.each(['lobby', 'in_game', 'finished'])('transfers ownership durably in %s without releasing either seat', async (phase) => {
    const h = roomHarness();
    if (phase !== 'lobby') await h.action(h.host, 'room:start');
    if (phase === 'finished') await h.finish();
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    const next = h.sockets[1]!;
    await h.action(next, 'room:join', { playerId: 'p2', playerToken: 'token-2' });
    const before = structuredClone(h.document);
    expect((await h.action(h.host, 'room:transferHost', { targetPlayerId: 'p2' })).ok).toBe(true);
    expect(h.document.meta.hostAccount).toBe('account-2');
    expect(h.document.meta.hostToken).not.toBe(before.meta.hostToken);
    expect(h.document.members).toEqual(before.members);
    expect(h.document.game).toEqual(before.game);
    expect(h.document.sessions).toEqual(before.sessions);
    const latest = (socket: Socket) => socket.messages.filter((m) => m.event === 'view:sync').at(-1)!.payload;
    expect(latest(next)).toMatchObject({ view: { isHost: true, room: { hostPlayerId: 'p2' } } });
    expect(latest(h.host)).toMatchObject({ view: { isHost: false, room: { hostPlayerId: 'p2' } } });
    expect((await h.action(h.host, 'room:transferHost', { targetPlayerId: 'p3' })).error?.code).toBe('NOT_HOST');
    h.wake();
    expect(await h.action(h.host, 'room:join', { hostToken: before.meta.hostToken })).toMatchObject({ data: { playerId: 'p0', isHost: false } });
    expect(await h.action(next, 'room:join')).toMatchObject({ data: { playerId: 'p2', isHost: true } });
  });

  it('rejects non-hosts, bots, empty seats, offline players and malformed targets', async () => {
    const h = roomHarness();
    expect((await h.action(h.spectator, 'room:transferHost', { targetPlayerId: 'p2' })).error?.code).toBe('NOT_HOST');
    expect((await h.action(h.host, 'room:transferHost', { targetPlayerId: 'p1' })).error?.code).toBe('INVALID_TARGET');
    await h.action(h.host, 'room:addBot');
    await h.room.webSocketClose(h.sockets[1]!);
    for (const targetPlayerId of ['p0', 'p1', 'p2', 'missing', 123, undefined]) {
      expect((await h.action(h.host, 'room:transferHost', { targetPlayerId })).error?.code).toBe('INVALID_TARGET');
    }
    expect(h.host.deserializeAttachment().isHost).toBe(true);
  });

  it('keeps ownership and published views unchanged when persistence fails', async () => {
    const h = roomHarness();
    await h.action(h.spectator, 'room:join');
    const before = structuredClone(h.document);
    const messages = h.spectator.messages.length;
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.action(h.host, 'room:transferHost', { targetPlayerId: 'p2' })).ok).toBe(false);
    expect(h.document).toEqual(before);
    expect(h.host.deserializeAttachment().isHost).toBe(true);
    expect(h.sockets[1]!.deserializeAttachment().isHost).toBe(false);
    expect(h.spectator.messages).toHaveLength(messages);
    h.room.stop();
  });
});
