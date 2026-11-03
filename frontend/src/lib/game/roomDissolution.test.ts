import { describe, expect, it } from 'vitest';
import type { RoomMember, RoomSnapshot } from '@/lib/socket/types';
import { wouldDissolveRoom } from './roomDissolution';

const human: RoomMember = { id: 'host', name: 'Host', seat: 0, claimed: true, connected: true, isSpectator: false };
const other = { ...human, id: 'other', seat: 1 };
function room(members: RoomMember[], status: RoomSnapshot['status'] = 'lobby') {
  return { members, status, hostPlayerId: 'host' } as RoomSnapshot;
}

describe('room dissolution warning', () => {
  it('warns when removing the last human even with bots, spectators and empty seats', () => {
    const snapshot = room([human, { ...other, isBot: true }, { ...other, id: 'spectator', isSpectator: true }, { ...other, id: 'empty', claimed: false }]);
    expect(wouldDissolveRoom(snapshot, 'host')).toBe(true);
    expect(wouldDissolveRoom(snapshot, 'other')).toBe(false);
  });

  it('preserves disconnected human seats unless the host leaves without a successor', () => {
    const snapshot = room([human, { ...other, connected: false }]);
    expect(wouldDissolveRoom(snapshot, 'host')).toBe(false);
    expect(wouldDissolveRoom(snapshot, 'host', true)).toBe(true);
  });

  it.each(['lobby', 'in_game', 'finished'] as const)('checks host successors in %s', (status) => {
    expect(wouldDissolveRoom(room([human, other], status), 'host', true)).toBe(false);
    expect(wouldDissolveRoom(room([human], status), 'host', true)).toBe(true);
    expect(wouldDissolveRoom(room([{ ...other, connected: false }], status), null, true)).toBe(true);
    expect(wouldDissolveRoom(room([other], status), null, true)).toBe(false);
  });

  it('does not warn for simply releasing a game seat or a spectator leaving', () => {
    expect(wouldDissolveRoom(room([human], 'in_game'), 'host')).toBe(false);
    expect(wouldDissolveRoom(room([human]), null)).toBe(false);
  });

  it('warns when returning to an empty lobby', () => {
    expect(wouldDissolveRoom(room([{ ...other, isBot: true }]), null)).toBe(true);
  });
});
