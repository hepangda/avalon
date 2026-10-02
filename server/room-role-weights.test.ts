import { ALL_ROLES, normalizeRoleWeights, settledRoleWeights, validRoleAssignment } from '@/lib/engine/roleWeights';
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomDocument } from "./persistence";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('non-blocking seating and role preferences', () => {
  function withAccounts() {
    const h = roomHarness();
    h.document.accounts = Object.fromEntries(h.sockets.filter((socket) => socket !== h.spectator)
      .map((socket) => [socket.deserializeAttachment().playerId!, socket.deserializeAttachment().account!]));
    return h;
  }

  it('starts when all previous seats conflict, allowing only the minimum one repeated seat', async () => {
    const h = withAccounts();
    h.document.lastGameSeats = {
      byPlayer: Object.fromEntries(Object.keys(h.document.accounts!).map((id) => [id, 0])),
      byAccount: Object.fromEntries(Object.values(h.document.accounts!).map((account) => [account, 0])),
    };
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.host.game.players).toHaveLength(5);
    expect(h.host.game.players.filter((player) => player.seat === 0)).toHaveLength(1);
    expect(h.document.meta.status).toBe('in_game');
  });

  it('ignores corrupt seat history and falls back when role preferences cannot be loaded', async () => {
    const h = withAccounts();
    h.document.lastGameSeats = { byPlayer: null, byAccount: 'corrupt' } as unknown as NonNullable<RoomDocument['lastGameSeats']>;
    vi.spyOn(h.persistence, 'getRoleWeights').mockRejectedValue(new Error('Preferences unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(validRoleAssignment(h.document.game!.config.roles, h.document.game!.players.map((player) => player.role))).toBe(true);
    expect(h.document.events.find(({ event }) => event.type === 'START_GAME')!.event).not.toHaveProperty('assignedRoles');
    await h.finish();
    expect(h.archives.size).toBe(1);
  });

  it('counts final roles once at game end, never on dealing or rerolling, and keeps preferences private', async () => {
    const h = withAccounts();
    const baseline = await h.persistence.getRoleWeights(Object.values(h.document.accounts!));
    expect((await h.action(h.host, 'room:start', { assignedRoles: Array(5).fill('Merlin') })).ok).toBe(true);
    await h.action(h.host, 'admin:auth');
    expect((await h.action(h.host, 'admin:rerollRoles')).ok).toBe(true);
    await h.persistence.getCards('account-0', Date.now());
    expect((await h.action(h.host, 'game:useRerollCard', { roleRevision: h.host.game.roleRevision })).ok).toBe(true);
    expect(await h.persistence.getRoleWeights(Object.keys(baseline))).toEqual(baseline);
    expect(h.persistence.roleWeightGames.size).toBe(0);
    for (const text of ['assignedRoles', 'roleWeightAssignments', 'account-0', 'roleWeights']) {
      expect(JSON.stringify(h.spectator.messages)).not.toContain(text);
    }
    const finalRoles = Object.fromEntries(h.document.game!.players.map((player) => [h.document.accounts![player.id]!, player.role]));
    await h.finish();
    const settled = await h.persistence.getRoleWeights(Object.keys(finalRoles));
    for (const [account, role] of Object.entries(finalRoles)) {
      expect(settled[account]).toEqual(settledRoleWeights(undefined, role));
      expect(settled[account]![role]).toBe(75);
      expect(ALL_ROLES.filter((other) => other !== role).every((other) => settled[account]![other] === 125)).toBe(true);
    }
    expect(h.persistence.roleWeightGames.size).toBe(5);
    const replay = h.archives.get(h.host.game.gameId!)!;
    expect(replay.roleAssignments.map(({ playerId, role }) => [playerId, role]))
      .toEqual(h.document.game!.players.map((player) => [player.id, player.role]));
    await h.action(h.host, 'admin:previousPhase');
    const assassin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Assassin')!;
    const merlin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Merlin')!;
    expect((await h.action(assassin, 'game:assassinate', { targetPlayerId: merlin.deserializeAttachment().playerId })).ok).toBe(true);
    expect(await h.persistence.getRoleWeights(Object.keys(finalRoles))).toEqual(settled);
    h.wake();
    await h.action(h.spectator, 'room:join');
    expect(await h.persistence.getRoleWeights(Object.keys(finalRoles))).toEqual(settled);
  });

  it('settles the final account holding a seat, including a late joiner', async () => {
    const h = withAccounts();
    await h.action(h.host, 'room:start');
    await h.action(h.sockets[1]!, 'room:releaseSeat');
    const late = new Socket({ account: 'late-weight-account', isHost: false, isAdmin: false });
    h.sockets.push(late);
    await h.action(late, 'room:claimSeat', { seatId: 'p2', name: 'Late' });
    const finalRole = late.game.selfRole!;
    await h.finish();
    expect(h.persistence.roleWeights.has('account-2')).toBe(false);
    expect(h.persistence.roleWeights.get('late-weight-account')).toEqual(settledRoleWeights(undefined, finalRole));
  });

  it('does not count a game whose result failed to commit, then settles the retry only once', async () => {
    const h = withAccounts();
    await h.action(h.host, 'room:start');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:startAssassination');
    const assassin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Assassin')!;
    const merlin = h.sockets.find((socket) => socket !== h.spectator && socket.game.selfRole === 'Merlin')!;
    const target = { targetPlayerId: merlin.deserializeAttachment().playerId };
    h.save.mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => { });
    expect((await h.action(assassin, 'game:assassinate', target)).ok).toBe(false);
    expect(h.persistence.roleWeightGames.size).toBe(0);
    expect((await h.persistence.getRoleWeights(['account-0']))['account-0']).toEqual(normalizeRoleWeights(undefined));
    h.wake();
    expect((await h.action(assassin, 'game:assassinate', target)).ok).toBe(true);
    expect(h.persistence.roleWeightGames.size).toBe(5);
  });
});
