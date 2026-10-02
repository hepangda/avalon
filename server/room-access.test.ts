import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('account-only socket access', () => {
  it.each(['room:join', 'room:claimSeat', 'room:start', 'admin:auth', 'notes:sync', 'game:vote', 'net:ping'])(
    'rejects %s without a verified account, even with old tokens or a forged payload',
    async (event) => {
      const h = roomHarness();
      const signedOut = new Socket({ isHost: true, isAdmin: true, playerId: 'p0' });
      const before = structuredClone(h.document);
      const result = await h.action(signedOut, event, {
        account: 'account-0', code: '1234', name: 'Old guest', seatId: 'p1',
        playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret', value: 'approve',
      });
      expect(result.error?.code).toBe('AUTH_REQUIRED');
      expect(signedOut.close).toHaveBeenCalledWith(1008, 'Sign in to enter a room');
      expect(h.document).toEqual(before);
      expect(h.save).not.toHaveBeenCalled();
      await h.action(h.spectator, 'room:join');
      expect(signedOut.messages.every((message) => message.t === 'ack')).toBe(true);
    },
  );

  it('allows authenticated spectators and token reconnects after runtime recreation', async () => {
    const h = roomHarness();
    h.wake();
    expect(await h.action(h.spectator, 'room:join')).toMatchObject({ ok: true, data: { isHost: false } });
    expect(h.spectator.snapshot.code).toBe('1234');
    expect(await h.action(h.host, 'room:join', {
      playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret',
    })).toMatchObject({ ok: true, data: { playerId: 'p0', isHost: true } });
  });
});
