import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('account reroll cards', () => {
  async function setup() {
    const h = roomHarness();
    h.host.serializeAttachment({ ...h.host.deserializeAttachment(), account: 'account-a' });
    await h.persistence.getCards('account-a', Date.now());
    const extra = new Socket({ account: "viewer-account", isHost: false, isAdmin: false });
    h.sockets.push(extra);
    await h.action(extra, 'room:claimSeat', { seatId: 'p1' });
    await h.action(h.host, 'room:join', { playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    return h;
  }

  it('atomically spends a card, redistributes private knowledge, and rejects a duplicate without spending', async () => {
    const h = await setup();
    const oldRole = h.host.game.selfRole;
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).ok).toBe(true);
    expect(h.host.game.selfRole).not.toBe(oldRole);
    expect(h.host.game.roleRevision).toBe(1);
    expect((await h.persistence.getCards('account-a')).cards).toBe(0);
    expect(h.spectator.game.selfRole).toBeNull();
    expect(JSON.stringify(h.spectator.messages)).not.toContain('account-a');
    await h.persistence.getCards('account-a', Date.now() + 86400000);
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).ok).toBe(false);
    expect((await h.persistence.getCards('account-a')).cards).toBe(1);
    h.wake();
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 1 })).ok).toBe(true);
    expect(h.host.game.roleRevision).toBe(2);
  });

  it('does not trust an account in the client payload and does not spend after acknowledgement', async () => {
    const h = await setup();
    expect((await h.action(h.spectator, 'game:useRerollCard', { roleRevision: 0, account: 'account-a', playerId: 'p0' })).error?.code).toBe('NOT_IN_ROOM');
    await h.action(h.host, 'game:ackRole', { roleRevision: 0 });
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).error?.code).toBe('WRONG_PHASE');
    expect((await h.persistence.getCards('account-a')).cards).toBe(1);
  });

  it('keeps the card and prior roles when persistence fails', async () => {
    const h = await setup();
    const before = structuredClone(h.document);
    vi.spyOn(console, 'error').mockImplementation(() => { });
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: 0 })).ok).toBe(false);
    expect(h.document).toEqual(before);
    expect((await h.persistence.getCards('account-a')).cards).toBe(1);
  });

  it('counts completion once even after rollback and a second settlement of the same game', async () => {
    const h = await setup();
    await h.finish();
    expect((await h.persistence.getCards('account-a')).completedGames).toBe(1);
    expect((await h.action(h.host, 'admin:previousPhase')).ok).toBe(true);
    const assassin = h.sockets.find((s) => s !== h.spectator && s.game.selfRole === 'Assassin')!;
    const merlin = h.document.game!.players.find((p) => p.role === 'Merlin')!;
    expect((await h.action(assassin, 'game:assassinate', { targetPlayerId: merlin.id })).ok).toBe(true);
    expect((await h.persistence.getCards('account-a')).completedGames).toBe(1);
  });

  it('does not credit an account that releases its seat before settlement', async () => {
    const h = await setup();
    await h.action(h.host, 'room:releaseSeat');
    expect(h.document.gameAccounts).not.toHaveProperty('p0');
    expect((await h.persistence.getCards('account-a')).completedGames).toBe(0);
  });
});
