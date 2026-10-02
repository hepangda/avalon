import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "./room-helpers";
import { roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('recommended lobby configuration', () => {
  it('resets custom rules, follows occupied seats in both directions, and survives reload before dealing', async () => {
    const h = roomHarness();
    expect((await h.action(h.host, 'room:config', {
      config: {
        ...DEFAULT_ROOM_CONFIG,
        useRecommended: true,
        options: { ...DEFAULT_ROOM_CONFIG.options, oberon: true, mordred: true, ladyOfTheLake: true, maxRejections: 2, speechSeconds: 600 },
      }
    })).ok).toBe(true);
    expect(h.host.snapshot.config.options).toMatchObject({ oberon: false, mordred: false, ladyOfTheLake: false, maxRejections: 5, speechSeconds: 120 });
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    expect(h.host.snapshot.config.options.oberon).toBe(false);
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    expect(h.spectator.snapshot.config.options.oberon).toBe(true);
    const bot = h.host.snapshot.members.find((member) => member.isBot)!;
    expect((await h.action(h.host, 'room:kick', { targetPlayerId: bot.id })).ok).toBe(true);
    expect(h.spectator.snapshot.config.options.oberon).toBe(false);
    expect((await h.action(h.host, 'room:addBot')).ok).toBe(true);
    h.wake();
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.document.game!.config.options).toMatchObject({ oberon: true, mordred: false, ladyOfTheLake: false, maxRejections: 5, speechSeconds: 120 });
    expect(h.document.game!.config.roles).toContain('Oberon');
  });

  it('allows custom settings again when the host turns recommendations off', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:config', { config: { ...DEFAULT_ROOM_CONFIG, useRecommended: true } });
    expect((await h.action(h.host, 'room:config', {
      config: {
        ...h.host.snapshot.config, useRecommended: false,
        options: { ...DEFAULT_ROOM_CONFIG.options, maxRejections: 2, speechSeconds: 60 },
      }
    })).ok).toBe(true);
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect(h.document.game!.config.options).toMatchObject({ maxRejections: 2, speechSeconds: 60 });
  });
});
