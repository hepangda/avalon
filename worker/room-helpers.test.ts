import { describe, expect, it } from 'vitest';
import type { RoomMember } from '@/lib/socket/types';
import type { RoomMeta } from './schema';
import {
  DEFAULT_ROOM_CONFIG,
  mergeConfig,
  restoreSeatIdentity,
  sanitizeAvatarUrl,
  sanitizeConfig,
  snapshot,
} from './room-helpers';

describe('game rule configuration', () => {
  it.each([
    [undefined, 5], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5],
    [0, 1], [6, 5], [2.9, 2], [NaN, 5], [Infinity, 5],
  ])('normalizes rejection limit %s to %i on creation and updates', (raw, expected) => {
    const config = {
      ...DEFAULT_ROOM_CONFIG,
      options: { ...DEFAULT_ROOM_CONFIG.options, maxRejections: raw },
    };
    expect(mergeConfig(config, []).options.maxRejections).toBe(expected);
    expect(sanitizeConfig(config, []).options.maxRejections).toBe(expected);
  });

  it.each([
    [false, false, false], [true, false, true],
    [false, true, true], [true, true, true],
  ])('bundles Morgana=%s and Percival=%s on creation and updates', (morgana, percival, enabled) => {
    const config = {
      ...DEFAULT_ROOM_CONFIG,
      options: { ...DEFAULT_ROOM_CONFIG.options, morgana, percival },
    };
    for (const normalized of [mergeConfig(config, []), sanitizeConfig(config, [])]) {
      expect(normalized.options.morgana).toBe(enabled);
      expect(normalized.options.percival).toBe(enabled);
    }
  });
});

describe('room snapshots', () => {
  it('publishes the host seat without exposing the host token', () => {
    const member: RoomMember = {
      id: 'player-id',
      name: 'Player 1',
      avatarUrl: 'https://auth.pangda.app/avatars/player-id',
      seat: 0,
      isSpectator: false,
      connected: true,
      claimed: true,
    };
    const meta: RoomMeta = {
      code: '0123',
      hostToken: 'private-host-token',
      status: 'lobby',
      config: { ...DEFAULT_ROOM_CONFIG, roster: [member.name] },
      gameId: null,
      seed: null,
    };

    const publicSnapshot = snapshot(meta, new Map([[member.id, member]]), member.id);
    expect(publicSnapshot.hostPlayerId).toBe(member.id);
    expect(publicSnapshot.members[0]?.avatarUrl).toBe(member.avatarUrl);
    expect(JSON.stringify(publicSnapshot)).not.toContain(meta.hostToken);
  });
});

describe('lobby seat identities', () => {
  it('restores the roster name and clears the occupant avatar after standing', () => {
    const member: RoomMember = {
      id: 'seat-2',
      name: 'Signed-in player',
      avatarUrl: 'https://auth.pangda.app/avatars/signed-in-player',
      seat: 1,
      isSpectator: false,
      connected: true,
      claimed: true,
    };

    restoreSeatIdentity(member, ['玩家 1', '玩家 2']);

    expect(member.name).toBe('玩家 2');
    expect(member.avatarUrl).toBeUndefined();
  });

  it('accepts web avatar URLs and rejects unsafe schemes', () => {
    expect(sanitizeAvatarUrl('https://auth.pangda.app/avatar/admin.png')).toBe(
      'https://auth.pangda.app/avatar/admin.png',
    );
    expect(sanitizeAvatarUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeAvatarUrl('not a URL')).toBeUndefined();
  });
});
