import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYER_AVATAR_POOL, playerAvatarUrl } from './playerAvatar';

describe('shared player avatar pool', () => {
  it('uses existing local assets with a stable, shared pool', () => {
    expect(PLAYER_AVATAR_POOL.length).toBeGreaterThanOrEqual(10);
    expect(new Set(PLAYER_AVATAR_POOL).size).toBe(PLAYER_AVATAR_POOL.length);
    for (const asset of PLAYER_AVATAR_POOL) {
      expect(asset).toMatch(/^\/assets\/game\/player-avatars\/[a-z0-9-]+\.webp$/);
      expect(existsSync(new URL(`../../../public${asset}`, import.meta.url))).toBe(true);
    }
  });

  it.each(['p0', 'player-123', '玩家-甲', '🛡️-seat-10', ''])('maps %s to the same portrait on every call', (id) => {
    const portrait = playerAvatarUrl(id);
    expect(PLAYER_AVATAR_POOL).toContain(portrait);
    for (let i = 0; i < 20; i++) {
      playerAvatarUrl(`unrelated-${i}`);
      expect(playerAvatarUrl(id)).toBe(portrait);
    }
  });

  it('distributes players across the entire pool', () => {
    const selected = new Set(Array.from({ length: 1000 }, (_, i) => playerAvatarUrl(`player-${i}`)));
    expect(selected.size).toBe(PLAYER_AVATAR_POOL.length);
  });

  it('does not reshuffle existing assignments when a portrait is appended or the manifest is reordered', () => {
    const original = PLAYER_AVATAR_POOL.slice(0, 5);
    const extra = PLAYER_AVATAR_POOL[5]!;
    for (let i = 0; i < 500; i++) {
      const id = `player-${i}`;
      const previous = playerAvatarUrl(id, original);
      expect(playerAvatarUrl(id, [...original].reverse())).toBe(previous);
      expect([previous, extra]).toContain(playerAvatarUrl(id, [...original, extra]));
    }
  });
});
