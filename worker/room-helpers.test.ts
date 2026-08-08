import { describe, expect, it } from 'vitest';
import type { RoomMember } from '@/lib/socket/types';
import type { RoomMeta } from './schema';
import {
  DEFAULT_ROOM_CONFIG,
  mergeConfig,
  sanitizeConfig,
  snapshot,
} from './room-helpers';

describe('voice room configuration', () => {
  it('defaults existing and new rooms to voice disabled', () => {
    expect(mergeConfig(undefined, []).voiceEnabled).toBe(false);
  });

  it('accepts voice mode only during room creation', () => {
    const created = mergeConfig({ voiceEnabled: true }, ['Player 1']);
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
    expect(JSON.stringify(publicSnapshot)).not.toContain(meta.hostToken);
  });
});
