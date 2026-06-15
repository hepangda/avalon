import type { GameEvent, GameOptions, GameState, PlayerId } from '@/lib/engine';
import { createGame, createRng, reduce } from '@/lib/engine';
import { prisma } from '@/lib/db/client';
import type { RoomConfig, RoomMember, RoomRuntime } from '../types';
import { gameStore } from './store';

/**
 * Rebuild a room's in-memory runtime from the database after a process
 * restart. Reconstructs the engine state by replaying the persisted event log
 * with the original seed — deterministic, so the result is bit-for-bit the
 * pre-crash state.
 *
 * Returns the runtime (also inserted into the store) or null if the room
 * doesn't exist / can't be rebuilt.
 */
export async function rebuildRoom(code: string): Promise<RoomRuntime | null> {
  const existing = gameStore.get(code);
  if (existing) return existing;

  const dbRoom = await prisma.room.findUnique({
    where: { code },
    include: { players: true, games: { orderBy: { startedAt: 'desc' }, take: 1 } },
  });
  if (!dbRoom) return null;

  const config = dbRoom.config as unknown as RoomConfig;
  const members = new Map<PlayerId, RoomMember>();
  for (const p of dbRoom.players) {
    members.set(p.id, {
      id: p.id,
      name: p.name,
      seat: p.seat,
      isSpectator: p.isSpectator,
      claimed: p.claimed,
      connected: false, // sockets reconnect fresh
    });
  }

  const runtime: RoomRuntime = {
    code,
    roomId: dbRoom.id,
    hostPlayerId: dbRoom.hostPlayerId,
    status: dbRoom.status,
    config,
    members,
    socketByPlayer: new Map(),
    spectatorSockets: new Set(),
    game: null,
    gameId: null,
    eventSeq: 0,
    persistChain: Promise.resolve(),
  };

  const game = dbRoom.games[0];
  if (game && dbRoom.status === 'in_game') {
    const rebuilt = await replayGame(game.id, game.seed, config.options, dbRoom.players);
    if (rebuilt) {
      runtime.game = rebuilt.state;
      runtime.gameId = game.id;
      runtime.eventSeq = rebuilt.lastSeq;
    }
  }

  gameStore.insert(runtime);
  return runtime;
}

async function replayGame(
  gameId: string,
  seed: string,
  options: GameOptions,
  dbPlayers: Array<{ id: string; name: string; seat: number; isSpectator: boolean }>,
): Promise<{ state: GameState; lastSeq: number } | null> {
  const seatedPlayers = dbPlayers
    .filter((p) => !p.isSpectator)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ id: p.id, name: p.name }));

  const created = createGame({
    hostId: seatedPlayers[0]?.id ?? '',
    players: seatedPlayers,
    options,
    seed,
  });
  if (!created.ok) {
    console.error('[rebuild] createGame failed during replay', created.error);
    return null;
  }

  const events = await prisma.gameEvent.findMany({
    where: { gameId },
    orderBy: { seq: 'asc' },
  });

  let state = created.state;
  let lastSeq = 0;
  for (const row of events) {
    const event = row.payload as unknown as GameEvent;
    const ctx = { now: row.createdAt.getTime(), rng: createRng(`${seed}:${row.seq}`) };
    const result = reduce(state, event, ctx);
    if (!result.ok) {
      // A persisted event should always be legal against the replayed state.
      // If not, the log is inconsistent — stop and use what we have.
      console.error(`[rebuild] replay refused at seq ${row.seq}: ${result.error.code}`);
      break;
    }
    state = result.state;
    lastSeq = row.seq;
  }

  return { state, lastSeq };
}
