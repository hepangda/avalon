import { prisma } from '../src/lib/db/client';

async function main() {
  const [rooms, games, events, rounds, votes, cards, lady, finished] = await Promise.all([
    prisma.room.count(),
    prisma.game.count(),
    prisma.gameEvent.count(),
    prisma.round.count(),
    prisma.vote.count(),
    prisma.missionCardRow.count(),
    prisma.ladyInspection.count(),
    prisma.game.count({ where: { finishedAt: { not: null } } }),
  ]);
  console.log({
    rooms,
    games,
    events,
    rounds,
    votes,
    missionCards: cards,
    ladyInspections: lady,
    finishedGames: finished,
  });
  const last = await prisma.game.findFirst({
    orderBy: { startedAt: 'desc' },
    select: { outcome: true, finishedAt: true },
  });
  console.log('last game outcome:', JSON.stringify(last?.outcome));
  await prisma.$disconnect();
}

main();
