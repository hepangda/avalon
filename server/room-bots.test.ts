import { afterEach, describe, expect, it, vi } from "vitest";
import { roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('server-controlled bots', () => {
  afterEach(() => vi.useRealTimers());

  it('restricts adding bots to the lobby host, protects their seats and supports removal', async () => {
    const h = roomHarness();
    expect((await h.action(h.spectator, 'room:addBot')).error?.code).toBe('NOT_HOST');
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    const bot = h.host.snapshot.members.find((m) => m.isBot)!;
    expect(bot).toMatchObject({ id: 'p1', claimed: true, connected: true });
    expect(h.document.sessions[bot.id]).toBeUndefined();
    expect((await h.action(h.spectator, 'room:claimSeat', { seatId: bot.id, name: 'Human' })).error?.code).toBe('SEAT_TAKEN');
    expect((await h.action(h.host, 'room:kick', { targetPlayerId: bot.id })).ok).toBe(true);
    expect(h.host.snapshot.members.find((m) => m.id === bot.id)).toMatchObject({ claimed: false });
    expect(h.document.members.find((m) => m.id === bot.id)?.isBot).toBeUndefined();
    await h.action(h.host, 'room:start');
    expect((await h.action(h.host, 'room:addBot')).error?.code).toBe('WRONG_PHASE');
  });

  it('acts immediately after resuming and honors timer pauses', async () => {
    vi.useFakeTimers();
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    await h.action(h.host, 'room:start');
    await h.action(h.host, 'net:ping');
    expect(h.document.game!.roleAcks).not.toContain('p1');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:setTimersPaused', { paused: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.document.game!.roleAcks).not.toContain('p1');
    await h.action(h.host, 'admin:setTimersPaused', { paused: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.document.game!.roleAcks).toContain('p1');
    // Clean up any subsequent bot action in this fake-clock room.
    await h.action(h.host, 'admin:setTimersPaused', { paused: true });
  });

  it('completes a game through automatic speeches, team votes and mission cards', async () => {
    vi.useFakeTimers();
    const h = roomHarness();
    // Make every occupied seat a bot to exercise consecutive automatic phases.
    for (const member of h.document.members) if (member.claimed) member.isBot = true;
    await h.action(h.host, 'room:start');
    for (let step = 0; step < 200 && h.document.game!.phase !== 'GameOver'; step++) {
      await vi.advanceTimersToNextTimerAsync();
      await h.room.drain();
    }
    expect(h.document.game!.phase).toBe('GameOver');
    expect(h.document.events.some(({ event }) => event.type === 'END_SPEECH')).toBe(true);
    expect(h.document.events.some(({ event }) => event.type === 'CAST_MISSION_CARD')).toBe(true);
    expect(h.document.archive?.replay.outcome).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restores pending bot actions and presence from persisted state', async () => {
    vi.useFakeTimers();
    const h = roomHarness();
    await h.action(h.host, 'room:addBot');
    await h.action(h.host, 'room:start');
    vi.clearAllTimers(); // Simulate process exit before the queued action runs.
    h.wake();
    await h.action(h.spectator, 'room:join');
    expect(h.spectator.snapshot.members.find((m) => m.id === 'p1')?.connected).toBe(true);
    expect(h.document.game!.roleAcks).not.toContain('p1');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.document.game!.roleAcks).toContain('p1');
    vi.clearAllTimers();
  });
});
