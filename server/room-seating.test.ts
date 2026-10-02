import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('self-service lobby seating', () => {
  async function setup() {
    const h = roomHarness(false);
    const created = await h.room.init({ code: '1234', creator: { name: 'Host', account: 'account-0' } });
    if (!created.ok) throw new Error(created.error);
    await h.action(h.host, 'room:join', created);
    return { h, created };
  }

  it('starts with only the creator and refuses to deal before five players sit down', async () => {
    const { h } = await setup();
    expect(h.document.members).toHaveLength(1);
    expect((await h.action(h.host, 'room:start')).error?.code).toBe('INVALID_PLAYER_COUNT');
    expect(h.document.meta.status).toBe('lobby');
  });

  it('allocates distinct seats atomically and caps simultaneous joins at ten players', async () => {
    const { h } = await setup();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const socket = new Socket({ account: `joiner-${i}`, isHost: false, isAdmin: false });
      return h.action(socket, 'room:claimSeat', { name: `Player ${i}`, avatarUrl: `https://example.com/${i}.png` });
    }));
    expect(results.filter((result) => result.ok)).toHaveLength(9);
    expect(results.filter((result) => result.error?.code === 'ROOM_FULL')).toHaveLength(3);
    expect(h.document.members).toHaveLength(10);
    expect(new Set(h.document.members.map((member) => member.id)).size).toBe(10);
    expect(h.document.members.map((member) => member.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(h.document.members.every((member) => member.claimed)).toBe(true);
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.host.game.players).toHaveLength(10);
  });

  it('keeps repeat clicks on the same seat and rejects a second seat for the same account', async () => {
    const { h, created } = await setup();
    const repeated = await h.action(h.host, 'room:claimSeat', { name: 'Host' });
    expect(repeated.data).toEqual({ playerId: created.playerId, playerToken: created.playerToken });
    const otherTab = new Socket({ account: 'account-0', isHost: false, isAdmin: false });
    expect((await h.action(otherTab, 'room:claimSeat', { name: 'Another' })).error?.code).toBe('ALREADY_SEATED');
    expect(h.document.members).toHaveLength(1);
  });

  it('reuses a released seat with a fresh token and the next account identity', async () => {
    const { h, created } = await setup();
    await h.action(h.host, 'room:releaseSeat');
    const result = await h.action(h.spectator, 'room:claimSeat', { name: 'Next', avatarUrl: 'https://example.com/next.png' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ playerId: created.playerId });
    expect((result.data as { playerToken: string }).playerToken).not.toBe(created.playerToken);
    expect(h.document.members).toHaveLength(1);
    expect(h.document.members[0]).toMatchObject({ name: 'Next', avatarUrl: 'https://example.com/next.png', claimed: true });
    h.wake();
    expect(await h.room.preview()).toMatchObject({ playerCount: 1 });
  });

  it('does not create placeholder seats when a sit request is invalid', async () => {
    const { h } = await setup();
    for (const name of ['', '  ', 'Host']) {
      expect((await h.action(h.spectator, 'room:claimSeat', { name })).ok).toBe(false);
      expect(h.document.members).toHaveLength(1);
      expect(h.document.meta.config.roster).toHaveLength(1);
    }
  });

  it('does not allocate new seats after the game starts', async () => {
    const h = roomHarness();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    const before = structuredClone(h.document);
    expect((await h.action(h.spectator, 'room:claimSeat', { name: 'Late' })).error?.code).toBe('WRONG_PHASE');
    expect(h.document).toEqual(before);
  });
});
