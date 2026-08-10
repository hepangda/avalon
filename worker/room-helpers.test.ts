import { describe, expect, it } from 'vitest';
import type { RoomMember } from '@/lib/socket/types';
import type { RoomMeta } from './schema';
import {
  DEFAULT_ROOM_CONFIG,
  mergeConfig,
  restoreLobbySeatIdentity,
  sanitizeAvatarUrl,
  sanitizeConfig,
  snapshot,
} from './room-helpers';

describe('voice room configuration', () => {
  it('defaults every new room to voice enabled', () => {
    expect(mergeConfig(undefined, []).voiceEnabled).toBe(true);
    expect(mergeConfig({ voiceEnabled: false }, []).voiceEnabled).toBe(true);
  });

  it('does not allow lobby edits to turn voice off', () => {
    const created = mergeConfig(undefined, ['Player 1']);
    expect(created.voiceEnabled).toBe(true);

    const edited = sanitizeConfig({ ...created, voiceEnabled: false }, created.roster, true);
    expect(edited.voiceEnabled).toBe(true);
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
      code: 'ABC123',
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

    restoreLobbySeatIdentity(member, ['玩家 1', '玩家 2']);

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
