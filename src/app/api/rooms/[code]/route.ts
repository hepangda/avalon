import { NextResponse } from 'next/server';
import { gameStore, rebuildRoom } from '@/lib/socket/server';

export const dynamic = 'force-dynamic';

/**
 * Public room preview for the join page — only non-sensitive fields. Never
 * exposes roles or in-progress game state.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = gameStore.get(code) ?? (await rebuildRoom(code));
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const seated = gameStore.activePlayers(room);
  return NextResponse.json({
    code: room.code,
    status: room.status,
    playerCount: seated.length,
    maxPlayers: room.config.maxPlayers,
    allowSpectators: room.config.allowSpectators,
    allowMidJoin: room.config.allowMidJoin,
  });
}
