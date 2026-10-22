import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMOTE_BURST, EMOTE_WINDOW_MS, EmoteLimiter } from './room-emotes';
import { EMOTE_GAP_MS } from '@/lib/game/emotes';
import { roomHarness, type Socket } from './test-room';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('emote rate limit', () => {
  it('keeps a gap between two reactions from one seat', () => {
    const limiter = new EmoteLimiter();
    expect(limiter.allow('p0', 1_000)).toBe(true);
    expect(limiter.allow('p0', 1_000 + EMOTE_GAP_MS - 1)).toBe(false);
    expect(limiter.allow('p0', 1_000 + EMOTE_GAP_MS)).toBe(true);
  });

  it('caps a burst within the window and recovers once it has passed', () => {
    const limiter = new EmoteLimiter();
    let now = 0;
    for (let i = 0; i < EMOTE_BURST; i++, now += EMOTE_GAP_MS) expect(limiter.allow('p0', now)).toBe(true);
    expect(limiter.allow('p0', now)).toBe(false);
    // Rejected attempts do not extend the window.
    expect(limiter.allow('p0', EMOTE_WINDOW_MS - 1)).toBe(false);
    expect(limiter.allow('p0', EMOTE_WINDOW_MS)).toBe(true);
  });

  it('limits each seat separately', () => {
    const limiter = new EmoteLimiter();
    expect(limiter.allow('p0', 0)).toBe(true);
    expect(limiter.allow('p2', 0)).toBe(true);
    expect(limiter.allow('p0', 10)).toBe(false);
    limiter.forget('p0');
    expect(limiter.allow('p0', 20)).toBe(true);
  });
});

describe('table:emote over the room socket', () => {
  const emotes = (socket: Socket) => socket.messages.filter((m) => m.event === 'table:emote').map((m) => m.payload);

  async function started() {
    const h = roomHarness();
    for (const [index, socket] of h.sockets.entries()) {
      const playerId = socket.deserializeAttachment().playerId;
      await h.action(socket, 'room:join', playerId
        ? { syncVersion: 1, playerId, playerToken: `token-${playerId.slice(1)}`, ...(index === 0 ? { hostToken: 'host-secret' } : {}) }
        : { syncVersion: 1 });
    }
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    return h;
  }

  it('broadcasts a seated player\'s reaction to the whole table without storing it', async () => {
    const h = await started();
    const before = structuredClone(h.document);
    const saves = h.save.mock.calls.length;
    const sender = h.sockets[1]!;
    expect(await h.action(sender, 'table:emote', { emote: 'suspect' })).toEqual({ ok: true });
    for (const socket of h.sockets) expect(emotes(socket)).toEqual([{ playerId: 'p2', emote: 'suspect' }]);
    expect(h.save.mock.calls.length).toBe(saves);
    expect(h.document).toEqual(before);
    expect(JSON.stringify(h.document)).not.toContain('suspect');
  });

  it('drops spam from one seat while others can still react', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
    const h = await started();
    const sender = h.sockets[1]!;
    expect((await h.action(sender, 'table:emote', { emote: 'approve' })).ok).toBe(true);
    expect((await h.action(sender, 'table:emote', { emote: 'approve' })).error?.code).toBe('RATE_LIMITED');
    expect((await h.action(h.sockets[2]!, 'table:emote', { emote: 'reject' })).ok).toBe(true);
    for (let i = 1; i < EMOTE_BURST; i++) {
      vi.setSystemTime(Date.now() + EMOTE_GAP_MS);
      expect((await h.action(sender, 'table:emote', { emote: 'question' })).ok).toBe(true);
    }
    vi.setSystemTime(Date.now() + EMOTE_GAP_MS);
    expect((await h.action(sender, 'table:emote', { emote: 'question' })).error?.code).toBe('RATE_LIMITED');
    expect(emotes(h.spectator)).toHaveLength(EMOTE_BURST + 1);
    vi.setSystemTime(Date.now() + EMOTE_WINDOW_MS);
    expect((await h.action(sender, 'table:emote', { emote: 'ponder' })).ok).toBe(true);
  });

  it('rejects spectators, unknown reactions and tables that have not been dealt', async () => {
    const lobby = roomHarness();
    await lobby.action(lobby.host, 'room:join', { syncVersion: 1, playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    expect((await lobby.action(lobby.host, 'table:emote', { emote: 'approve' })).error?.code).toBe('NOT_SEATED');

    const h = await started();
    expect((await h.action(h.spectator, 'table:emote', { emote: 'approve' })).error?.code).toBe('NOT_SEATED');
    expect((await h.action(h.host, 'table:emote', { emote: 'laugh' })).error?.code).toBe('INVALID');
    expect((await h.action(h.host, 'table:emote', null as never)).error?.code).toBe('INVALID');
    expect(h.sockets.flatMap(emotes)).toEqual([]);
  });
});
