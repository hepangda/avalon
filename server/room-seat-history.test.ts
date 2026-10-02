import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('seat history across games', () => {
  it('follows accounts after standing and reclaiming a different player ID, including runtime recreation', async () => {
    const h = roomHarness();
    for (const socket of h.sockets.filter((socket) => socket !== h.spectator)) {
      const playerId = socket.deserializeAttachment().playerId!;
      await h.action(socket, 'room:join', {
        playerId, playerToken: `token-${playerId.slice(1)}`,
        ...(socket === h.host ? { hostToken: 'host-secret' } : {}),
      });
    }
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    const history = structuredClone(h.document.lastGameSeats!);
    await h.finish();
    await h.action(h.host, 'room:restart');
    const a = h.sockets[1]!;
    const b = h.sockets[2]!;
    await h.action(a, 'room:releaseSeat');
    await h.action(b, 'room:releaseSeat');
    expect((await h.action(a, 'room:claimSeat', { seatId: 'p3', name: 'Player 2' })).ok).toBe(true);
    expect((await h.action(b, 'room:claimSeat', { seatId: 'p2', name: 'Player 3' })).ok).toBe(true);
    expect(h.document.lastGameSeats).toEqual(history);
    h.wake();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    for (const player of h.host.game.players) {
      const account = h.document.accounts![player.id]!;
      expect(player.seat).not.toBe(history.byAccount[account]);
    }
    expect(h.document.accounts!.p3).toBe('account-2');
    expect(h.document.accounts!.p2).toBe('account-3');
    await h.finish();
    expect(h.archives.size).toBe(2);
  });

  it('also remembers the seat of an account that joined during the previous game', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    const oldSeat = h.host.game.players.find((player) => player.id === 'p2')!.seat;
    await h.action(h.sockets[1]!, 'room:releaseSeat');
    const late = new Socket({ account: 'late-account', isHost: false, isAdmin: false });
    h.sockets.push(late);
    await h.action(late, 'room:claimSeat', { seatId: 'p2', name: 'Late' });
    expect(h.document.lastGameSeats?.byAccount['late-account']).toBe(oldSeat);
    await h.finish();
    await h.action(h.host, 'room:restart');
    h.wake();
    await h.action(h.host, 'room:start');
    expect(late.game.players.find((player) => player.id === 'p2')!.seat).not.toBe(oldSeat);
  });

  it('migrates a game snapshot without explicit seat history before starting the next game', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    const previous = Object.fromEntries(h.host.game.players.map((player) => [player.id, player.seat]));
    delete h.document.lastGameSeats;
    h.wake();
    await h.finish();
    await h.action(h.host, 'room:restart');
    h.wake();
    await h.action(h.host, 'room:start');
    for (const player of h.host.game.players) expect(player.seat).not.toBe(previous[player.id]);
  });

  it('keeps the previous order and history intact if committing a new deal fails', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:start');
    await h.finish();
    await h.action(h.host, 'room:restart');
    const before = structuredClone(h.document);
    const history = before.lastGameSeats!;
    const pushes = h.host.messages.filter((message) => message.t === 'push').length;
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => { });
    expect((await h.action(h.host, 'room:start')).ok).toBe(false);
    expect(h.document).toEqual(before);
    expect(h.host.messages.filter((message) => message.t === 'push')).toHaveLength(pushes);
    h.wake();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    for (const player of h.host.game.players) expect(player.seat).not.toBe(history.byPlayer[player.id]);
  });
});
