import type { RoomSnapshot } from '@/lib/socket/types';

/** Mirrors immediate dissolution: no human seats in a lobby, or no host successor. */
export function wouldDissolveRoom(
  snapshot: RoomSnapshot,
  removedPlayerId: string | null,
  hostLeaving = false,
): boolean {
  const remaining = snapshot.members.filter((member) =>
    member.claimed && !member.isSpectator && !member.isBot && member.id !== removedPlayerId,
  );
  return (snapshot.status === 'lobby' && remaining.length === 0)
    || (hostLeaving && !remaining.some((member) => member.connected && member.id !== snapshot.hostPlayerId));
}
