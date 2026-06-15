import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/**
 * Full replay data for a finished game: per-round leader/team/votes/result,
 * Lady inspections, assassination, and the final role reveal. Mission cards
 * (who played what) are included here — they are only ever exposed post-game.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      rounds: {
        orderBy: { roundIndex: 'asc' },
        include: { votes: true, missionCards: true },
      },
      ladyChecks: { orderBy: { roundIndex: 'asc' } },
      assassination: true,
      room: { include: { players: true } },
    },
  });

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  if (!game.finishedAt) {
    return NextResponse.json({ error: 'Game not finished' }, { status: 409 });
  }

  return NextResponse.json({
    gameId: game.id,
    outcome: game.outcome,
    roleAssignments: game.roleAssignments,
    players: game.room.players
      .filter((p) => !p.isSpectator)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    rounds: game.rounds.map((r) => ({
      roundIndex: r.roundIndex,
      leaderPlayerId: r.leaderPlayerId,
      teamSize: r.teamSize,
      finalTeam: r.finalTeam,
      approved: r.approved,
      missionSuccess: r.missionSuccess,
      failCount: r.failCount,
      votes: r.votes.map((v) => ({
        proposalIndex: v.proposalIndex,
        playerId: v.playerId,
        value: v.value,
      })),
      missionCards: r.missionCards.map((c) => ({ playerId: c.playerId, card: c.card })),
    })),
    ladyChecks: game.ladyChecks.map((l) => ({
      roundIndex: l.roundIndex,
      holderPlayerId: l.holderPlayerId,
      targetPlayerId: l.targetPlayerId,
      revealedTeam: l.revealedTeam,
    })),
    assassination: game.assassination
      ? {
          assassinPlayerId: game.assassination.assassinPlayerId,
          targetPlayerId: game.assassination.targetPlayerId,
          hitMerlin: game.assassination.hitMerlin,
        }
      : null,
  });
}
