import type { Server } from 'socket.io';
import type { EngineContext, GameEvent, GameState } from '@/lib/engine';
import { createRng, projectStateForViewer, reduce } from '@/lib/engine';
import type {
  ClientToServerEvents,
  InterServerEvents,
  RoomRuntime,
  ServerToClientEvents,
  SocketData,
} from '../types';
import { recordEvent, runEffects } from './persistence';
import { gameStore } from './store';

export type AvalonServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Build an EngineContext. Time/randomness injected so the engine stays pure. */
function makeCtx(seed: string, seq: number): EngineContext {
  // Derive a per-event RNG stream from the game seed + event sequence so any
  // future randomness is deterministic & replayable.
  return { now: Date.now(), rng: createRng(`${seed}:${seq}`) };
}

/**
 * Project state for a viewer and stamp the DB game id (the pure engine leaves
 * gameId null; only the socket layer knows the persistence id).
 */
function projectFor(room: RoomRuntime, playerId: string) {
  const view = projectStateForViewer(room.game!, playerId);
  view.gameId = room.gameId;
  // Stamp socket-layer player attributes the pure engine has no knowledge of:
  // self-measured latency and whether the seat is claimed.
  for (const p of view.players) {
    const member = room.members.get(p.id);
    if (!member) continue;
    if (member.latency !== undefined) p.latency = member.latency;
    p.claimed = member.claimed;
  }
  return view;
}

/**
 * Broadcast the per-viewer projected state to every member of a room (players
 * and spectators alike), each redacted for that viewer.
 */
export function broadcastState(io: AvalonServer, room: RoomRuntime): void {
  if (!room.game) return;
  for (const [playerId, socketId] of room.socketByPlayer) {
    io.to(socketId).emit('state:sync', projectFor(room, playerId));
  }
  // Unseated/spectator sockets all get the same spectator projection.
  if (room.spectatorSockets.size > 0) {
    const view = projectFor(room, SPECTATOR_VIEWER);
    for (const socketId of room.spectatorSockets) {
      io.to(socketId).emit('state:sync', view);
    }
  }
}

/** A viewer id guaranteed not to match any seat → projects the spectator view. */
const SPECTATOR_VIEWER = '__spectator__';

/** Emit the public room snapshot to everyone in the room channel. */
export function broadcastRoom(io: AvalonServer, room: RoomRuntime): void {
  io.to(room.code).emit('room:snapshot', gameStore.snapshot(room));
}

/**
 * Apply a game event through the engine, persist it, run checkpoint effects,
 * deliver private effects, and broadcast the new state. Returns the engine
 * result so callers can surface refusals to the actor.
 */
export async function applyEvent(
  io: AvalonServer,
  room: RoomRuntime,
  event: GameEvent,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!room.game) return { ok: false, code: 'NO_GAME', message: 'No game in progress' };

  const prevState: GameState = room.game;
  const seq = room.eventSeq + 1;
  const ctx = makeCtx(prevState.seed, seq);
  const result = reduce(prevState, event, ctx);

  if (!result.ok) {
    return { ok: false, code: result.error.code, message: result.error.message };
  }

  // Commit in memory first (authoritative), then persist best-effort.
  room.game = result.state;
  room.eventSeq = seq;

  // Persist event log + checkpoints serially per room so concurrent actions
  // (e.g. the final vote + its resolution) never race on the same round row.
  // Chained off room.persistChain; failures are swallowed so the chain
  // survives and the in-memory game is never blocked.
  const effects = result.effects;
  const committedPrev = prevState;
  const committedNext = result.state;
  room.persistChain = room.persistChain
    .then(() => recordEvent(room, event, seq))
    .then(() => runEffects(room, effects, committedPrev, committedNext))
    .catch((e) => console.error('[persist] chain error', e));

  // Deliver private effects (Lady inspection result to the holder only).
  for (const effect of result.effects) {
    if (effect.kind === 'PRIVATE_LADY') {
      const socketId = room.socketByPlayer.get(effect.holderId);
      if (socketId) {
        io.to(socketId).emit('private:lady', {
          targetId: effect.targetId,
          loyalty: effect.loyalty,
        });
      }
    }
  }

  broadcastState(io, room);
  return { ok: true };
}

/**
 * Send the private role reveal to a single player (used on RoleReveal entry and
 * on reconnect while in RoleReveal).
 */
export function sendPrivateReveal(io: AvalonServer, room: RoomRuntime, playerId: string): void {
  if (!room.game) return;
  const view = projectStateForViewer(room.game, playerId);
  if (view.selfRole) {
    const socketId = room.socketByPlayer.get(playerId);
    if (socketId) {
      io.to(socketId).emit('private:reveal', {
        selfRole: view.selfRole,
        knownPlayers: view.knownPlayers,
      });
    }
  }
}

/** Send a full state sync to one player (reconnect path). */
export function syncOne(io: AvalonServer, room: RoomRuntime, playerId: string): void {
  if (!room.game) return;
  const socketId = room.socketByPlayer.get(playerId);
  if (!socketId) return;
  io.to(socketId).emit('state:sync', projectFor(room, playerId));
}

/**
 * Append a red "admin" (referee) log line directly to the live game state and
 * broadcast it. Used for super-password actions whose audit trail must be
 * public, but which are out-of-band of the engine (panel open/close, unbind) or
 * whose actor name the pure engine has no knowledge of (act-as-player). The
 * actual game-state changes are persisted through their own applyEvent; this
 * audit line is in-memory only (not checkpointed), which is acceptable.
 *
 * `actor` is passed as a resolved display name (the engine/client never need to
 * look it up); other player params stay as ids and resolve client-side.
 */
export function pushAdminLog(
  io: AvalonServer,
  room: RoomRuntime,
  key: string,
  params: Record<string, string | number>,
): void {
  if (!room.game) return;
  room.game.logSeq += 1;
  room.game.logs.push({
    seq: room.game.logSeq,
    roundIndex: room.game.roundIndex,
    at: Date.now(),
    channel: 'public',
    key,
    params,
    style: 'admin',
  });
  broadcastState(io, room);
}

/** Send the spectator-projected state to one unseated socket. */
export function syncSpectatorSocket(io: AvalonServer, room: RoomRuntime, socketId: string): void {
  if (!room.game) return;
  io.to(socketId).emit('state:sync', projectFor(room, SPECTATOR_VIEWER));
}
