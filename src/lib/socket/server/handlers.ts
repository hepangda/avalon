import type { Socket } from 'socket.io';
import { buildRoleSet, createGame, leaderId } from '@/lib/engine';
import { prisma } from '@/lib/db/client';
import { fallbackSeatName } from '@/lib/game/names';
import type {
  Ack,
  ClientToServerEvents,
  InterServerEvents,
  RoomConfig,
  RoomRuntime,
  ServerToClientEvents,
  SocketData,
} from '../types';
import { gameStore } from './store';
import { rebuildRoom } from './rebuild';
import {
  applyEvent,
  broadcastRoom,
  broadcastState,
  pushAdminLog,
  sendPrivateReveal,
  syncOne,
  syncSpectatorSocket,
  type AvalonServer,
} from './runtime';

type AvalonSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type AvalonSocketInit = AvalonSocket;

const ok = <T>(data?: T): Ack<T> => ({ ok: true, data });
const fail = <T = undefined>(code: string, message: string): Ack<T> => ({
  ok: false,
  error: { code, message },
});

/** A socket is the host if it authenticated with the room's host token. */
function isHostSocket(socket: AvalonSocket): boolean {
  return socket.data.isHost === true;
}

/** A socket has referee powers if it authenticated with the super-password. */
function isAdminSocket(socket: AvalonSocket): boolean {
  return socket.data.isAdmin === true;
}

/** Sentinel actor name for an admin operator who holds no seat. The client maps
 *  it to a localized "someone" label; real names pass through verbatim. */
const ADMIN_ANON = '__admin_someone__';

/** Resolve the display name to attribute an admin action to: the operator's
 *  claimed seat name, or the anon sentinel if they hold no seat. */
function adminActorName(room: RoomRuntime, socket: AvalonSocket): string {
  const pid = socket.data.playerId;
  const member = pid ? room.members.get(pid) : undefined;
  return member?.name ?? ADMIN_ANON;
}

/** Attach all client→server handlers to a freshly connected socket. */
export function registerHandlers(io: AvalonServer, socket: AvalonSocket): void {
  // -------------------------------------------------------------------------
  // room:join — connect to a room (NEW model: join does NOT take a seat).
  // Identifies the host via hostToken, restores a previously-claimed seat via
  // playerId (reconnect), otherwise just attaches the socket to the room and
  // waits for room:claimSeat.
  // -------------------------------------------------------------------------
  socket.on('room:join', async ({ code, playerId, hostToken }, ack) => {
    try {
      const room = gameStore.get(code) ?? (await rebuildRoom(code));
      if (!room) return ack(fail('ROOM_NOT_FOUND', `No room ${code}`));

      socket.data.code = code;
      await socket.join(code);

      // Host authentication (owner token). Independent of holding a seat.
      const isHost = !!hostToken && hostToken === room.hostPlayerId;
      socket.data.isHost = isHost;

      // Reconnect path: a previously-claimed seat. Re-bind the socket to it.
      if (playerId && room.members.has(playerId)) {
        const member = room.members.get(playerId)!;
        if (member.claimed) {
          member.connected = true;
          room.socketByPlayer.set(playerId, socket.id);
          socket.data.playerId = playerId;

          if (room.game) {
            await applyEvent(io, room, { type: 'SET_CONNECTED', by: playerId, connected: true });
          }
          void prisma.player
            .update({ where: { id: playerId }, data: { connected: true, lastSeenAt: new Date() } })
            .catch(() => {});

          broadcastRoom(io, room);
          if (room.game) syncOne(io, room, playerId);
          return ack(ok({ playerId, isHost }));
        }
      }

      // Otherwise: attached but unseated → spectator view. Track the socket and
      // send the snapshot + (if a game is running) the spectator-projected state.
      room.spectatorSockets.add(socket.id);
      broadcastRoom(io, room);
      if (room.game) syncSpectatorSocket(io, room, socket.id);
      return ack(ok({ isHost }));
    } catch (e) {
      console.error('[room:join] error', e);
      return ack(fail('INTERNAL', 'Join failed'));
    }
  });

  // -------------------------------------------------------------------------
  // room:claimSeat — take an unclaimed roster seat (or switch to another).
  // -------------------------------------------------------------------------
  socket.on('room:claimSeat', async ({ seatId }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));

    const target = room.members.get(seatId);
    if (!target || target.isSpectator) return ack(fail('UNKNOWN_SEAT', 'No such seat'));
    if (target.claimed && room.socketByPlayer.get(seatId) !== socket.id) {
      return ack(fail('SEAT_TAKEN', 'That seat is already taken'));
    }

    // Release any seat this socket currently holds (seat switch).
    const prevId = socket.data.playerId;
    if (prevId && prevId !== seatId) {
      releaseSeat(room, prevId);
      void prisma.player
        .update({ where: { id: prevId }, data: { claimed: false, connected: false } })
        .catch(() => {});
      if (room.game) {
        await applyEvent(io, room, { type: 'SET_CONNECTED', by: prevId, connected: false });
      }
    }

    // Claim the target seat.
    target.claimed = true;
    target.connected = true;
    room.socketByPlayer.set(seatId, socket.id);
    room.spectatorSockets.delete(socket.id);
    socket.data.playerId = seatId;
    void prisma.player
      .update({ where: { id: seatId }, data: { claimed: true, connected: true, lastSeenAt: new Date() } })
      .catch(() => {});
    if (room.game) {
      await applyEvent(io, room, { type: 'SET_CONNECTED', by: seatId, connected: true });
    }

    broadcastRoom(io, room);
    if (room.game) syncOne(io, room, seatId);
    return ack(ok({ playerId: seatId }));
  });

  // -------------------------------------------------------------------------
  // room:releaseSeat — give up the current seat (becomes unseated/spectator).
  // -------------------------------------------------------------------------
  socket.on('room:releaseSeat', async (_p, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    const pid = socket.data.playerId;
    if (!pid) return ack(ok());

    releaseSeat(room, pid);
    socket.data.playerId = undefined;
    room.spectatorSockets.add(socket.id);
    void prisma.player
      .update({ where: { id: pid }, data: { claimed: false, connected: false } })
      .catch(() => {});
    if (room.game) {
      await applyEvent(io, room, { type: 'SET_CONNECTED', by: pid, connected: false });
      syncSpectatorSocket(io, room, socket.id);
    }
    broadcastRoom(io, room);
    return ack(ok());
  });

  // -------------------------------------------------------------------------
  // room:setRoster — host edits the seat names (lobby only).
  // -------------------------------------------------------------------------
  socket.on('room:setRoster', async ({ names }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isHostSocket(socket)) return ack(fail('NOT_HOST', 'Only host'));
    if (room.status !== 'lobby') return ack(fail('WRONG_PHASE', 'Game already started'));

    const res = await applyRoster(room, names);
    if (!res.ok) return ack(fail(res.code, res.message));
    broadcastRoom(io, room);
    return ack(ok());
  });

  // -------------------------------------------------------------------------
  // room:config — host updates lobby configuration.
  // -------------------------------------------------------------------------
  socket.on('room:config', async ({ config }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isHostSocket(socket)) return ack(fail('NOT_HOST', 'Only host'));
    if (room.status !== 'lobby') return ack(fail('WRONG_PHASE', 'Game already started'));

    room.config = sanitizeConfig(config, room.config.roster);
    void prisma.room
      .update({ where: { id: room.roomId }, data: { config: room.config as unknown as object } })
      .catch(() => {});
    broadcastRoom(io, room);
    return ack(ok());
  });

  // -------------------------------------------------------------------------
  // room:rename — a player changes their own display name (must stay unique).
  // -------------------------------------------------------------------------
  socket.on('room:rename', async ({ name }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    const pid = socket.data.playerId;
    if (!pid) return ack(fail('NOT_IN_ROOM', 'No player id'));
    const member = room.members.get(pid);
    if (!member) return ack(fail('UNKNOWN_PLAYER', 'No such player'));

    const desired = gameStore.sanitizeName(name);
    if (!desired) return ack(fail('INVALID_NAME', 'Name cannot be empty'));
    if (gameStore.isNameTaken(room, desired, pid)) {
      return ack(fail('NAME_TAKEN', 'That name is already taken in this room'));
    }

    member.name = desired;
    void prisma.player.update({ where: { id: pid }, data: { name: desired } }).catch(() => {});
    broadcastRoom(io, room);
    return ack(ok({ name: desired }));
  });

  // -------------------------------------------------------------------------
  // room:kick — host frees a seat (kicks its occupant but keeps the empty seat
  // in the roster). Lobby only.
  // -------------------------------------------------------------------------
  socket.on('room:kick', async ({ targetPlayerId }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isHostSocket(socket)) return ack(fail('NOT_HOST', 'Only host'));
    if (room.status !== 'lobby') return ack(fail('WRONG_PHASE', 'Cannot kick mid-game'));
    if (!room.members.has(targetPlayerId)) return ack(fail('UNKNOWN_PLAYER', 'No such seat'));

    const targetSocket = room.socketByPlayer.get(targetPlayerId);
    if (targetSocket) {
      io.to(targetSocket).emit('system:notice', { type: 'kicked', message: 'You were removed' });
    }
    // Free the seat (keep it in the roster, just unclaimed) rather than delete.
    releaseSeat(room, targetPlayerId);
    void prisma.player
      .update({ where: { id: targetPlayerId }, data: { claimed: false, connected: false } })
      .catch(() => {});
    broadcastRoom(io, room);
    return ack(ok());
  });

  socket.on('room:transferHost', async ({ targetPlayerId }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isHostSocket(socket)) return ack(fail('NOT_HOST', 'Only host'));
    if (!room.members.has(targetPlayerId)) return ack(fail('UNKNOWN_PLAYER', 'No such player'));
    // Host identity is an owner token, not a seat, so transfer is not supported
    // in the seat-claim model. Reserved for a future ownership-handoff flow.
    return ack(fail('NOT_SUPPORTED', 'Host transfer is not available'));
  });

  // -------------------------------------------------------------------------
  // room:start — host deals roles and begins the game. The roster may have
  // unclaimed seats; they still enter the engine (the game stalls on their
  // turn until someone claims them). Roster total must be 5–10 to deal.
  // -------------------------------------------------------------------------
  socket.on('room:start', async (_p, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isHostSocket(socket)) return ack(fail('NOT_HOST', 'Only host'));
    if (room.status !== 'lobby') return ack(fail('WRONG_PHASE', 'Already started'));

    const seated = gameStore.activePlayers(room);
    if (seated.length < 5 || seated.length > 10) {
      return ack(fail('INVALID_PLAYER_COUNT', 'Need 5–10 roster seats to deal'));
    }
    // Validate the role set fits before we create anything.
    try {
      buildRoleSet(seated.length, room.config.options);
    } catch (e) {
      return ack(fail('INVALID_ROLE_SET', (e as Error).message));
    }

    const seed = `${room.code}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const created = createGame({
      hostId: seated[0]!.id,
      players: seated.map((m) => ({ id: m.id, name: m.name })),
      options: room.config.options,
      seed,
    });
    if (!created.ok) return ack(fail(created.error.code, created.error.message));

    // Persist a Game row, then start (assignRoles) through applyEvent.
    const dbGame = await prisma.game.create({
      data: { roomId: room.roomId, seed, roleAssignments: [] },
    });
    room.game = created.state;
    room.gameId = dbGame.id;
    room.eventSeq = 0;
    room.status = 'in_game';

    const res = await applyEvent(io, room, { type: 'START_GAME', by: seated[0]!.id });
    if (!res.ok) return ack(fail(res.code, res.message));

    // Push private reveals to currently-claimed players (the reveal also rides
    // projected state, so unclaimed/late seats get it on claim).
    for (const m of seated) if (m.claimed) sendPrivateReveal(io, room, m.id);
    broadcastRoom(io, room);
    return ack(ok());
  });

  // -------------------------------------------------------------------------
  // Game actions → engine via applyEvent.
  // -------------------------------------------------------------------------
  socket.on('game:ackRole', (_p, ack) => gameAction(socket, ack, (pid) => ({ type: 'ACK_ROLE', by: pid })));
  socket.on('game:proposeTeam', ({ team }, ack) =>
    gameAction(socket, ack, (pid) => ({ type: 'PROPOSE_TEAM', by: pid, team })),
  );
  socket.on('game:vote', ({ value }, ack) =>
    gameAction(socket, ack, (pid) => ({ type: 'CAST_VOTE', by: pid, value })),
  );
  socket.on('game:missionCard', ({ card }, ack) =>
    gameAction(socket, ack, (pid) => ({ type: 'CAST_MISSION_CARD', by: pid, card })),
  );
  socket.on('game:useLady', ({ targetPlayerId }, ack) =>
    gameAction(socket, ack, (pid) => ({ type: 'USE_LADY', by: pid, target: targetPlayerId })),
  );
  socket.on('game:assassinate', ({ targetPlayerId }, ack) =>
    gameAction(socket, ack, (pid) => ({ type: 'ASSASSINATE', by: pid, target: targetPlayerId })),
  );

  // -------------------------------------------------------------------------
  // net:ping — latency heartbeat. Ack immediately so the client can time the
  // round trip; record the client's previous measurement so the rest of the
  // room can see this player's self-measured latency.
  // -------------------------------------------------------------------------
  socket.on('net:ping', ({ rtt }, ack) => {
    const room = currentRoom(socket);
    const pid = socket.data.playerId;
    if (room && pid && typeof rtt === 'number' && Number.isFinite(rtt)) {
      const member = room.members.get(pid);
      if (member) {
        const clamped = Math.max(0, Math.min(9999, Math.round(rtt)));
        if (member.latency !== clamped) {
          member.latency = clamped;
          broadcastRoom(io, room);
          if (room.game) broadcastState(io, room);
        }
      }
    }
    return ack(ok());
  });

  // -------------------------------------------------------------------------
  // Referee (admin) actions. Per-socket authorization — anyone may enable the
  // referee panel; no password. The server performs every "act as player"
  // action itself; the operator's client never assumes the target's identity,
  // so no private role/vision is ever leaked to the operator.
  // -------------------------------------------------------------------------
  socket.on('admin:auth', async (_p, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    socket.data.isAdmin = true;
    if (room.game) pushAdminLog(io, room, 'admin.panelOpened', { actor: adminActorName(room, socket) });
    return ack(ok({ ok: true }));
  });

  socket.on('admin:close', async (_p, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isAdminSocket(socket)) return ack(ok());
    socket.data.isAdmin = false;
    if (room.game) pushAdminLog(io, room, 'admin.panelClosed', { actor: adminActorName(room, socket) });
    return ack(ok());
  });

  socket.on('admin:unbind', async ({ targetPlayerId }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isAdminSocket(socket)) return ack(fail('NOT_ADMIN', 'Referee panel not enabled'));
    const target = room.members.get(targetPlayerId);
    if (!target || target.isSpectator) return ack(fail('UNKNOWN_PLAYER', 'No such seat'));

    const actor = adminActorName(room, socket);
    const targetName = target.name;

    // Boot the occupant's live socket back to a spectator view, then free the
    // seat (it stays in the roster, claimable again by anyone).
    const targetSocketId = room.socketByPlayer.get(targetPlayerId);
    releaseSeat(room, targetPlayerId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('system:notice', { type: 'unbound', message: 'You were unbound by a referee' });
    }
    void prisma.player
      .update({ where: { id: targetPlayerId }, data: { claimed: false, connected: false } })
      .catch(() => {});
    if (room.game) {
      await applyEvent(io, room, { type: 'SET_CONNECTED', by: targetPlayerId, connected: false });
    }

    pushAdminLog(io, room, 'admin.unbound', { actor, target: targetName });
    broadcastRoom(io, room);
    if (room.game && targetSocketId) syncSpectatorSocket(io, room, targetSocketId);
    return ack(ok());
  });

  socket.on('admin:vote', async ({ targetPlayerId, value }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isAdminSocket(socket)) return ack(fail('NOT_ADMIN', 'Referee panel not enabled'));
    const target = room.members.get(targetPlayerId);
    if (!target || target.isSpectator) return ack(fail('UNKNOWN_PLAYER', 'No such player'));

    const res = await applyEvent(io, room, {
      type: 'CAST_VOTE',
      by: targetPlayerId,
      value,
      admin: true,
    });
    if (!res.ok) return ack(fail(res.code, res.message));
    pushAdminLog(io, room, 'admin.votedFor', {
      actor: adminActorName(room, socket),
      target: target.name,
      value,
    });
    return ack(ok());
  });

  socket.on('admin:propose', async ({ team }, ack) => {
    const room = currentRoom(socket);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    if (!isAdminSocket(socket)) return ack(fail('NOT_ADMIN', 'Referee panel not enabled'));
    if (!room.game) return ack(fail('NO_GAME', 'No game in progress'));
    if (room.game.phase !== 'TeamBuilding') return ack(fail('WRONG_PHASE', 'Not in TeamBuilding'));

    const leader = leaderId(room.game);
    const res = await applyEvent(io, room, {
      type: 'PROPOSE_TEAM',
      by: leader,
      team,
      admin: true,
    });
    if (!res.ok) return ack(fail(res.code, res.message));
    const leaderName = room.members.get(leader)?.name ?? leader;
    pushAdminLog(io, room, 'admin.proposedFor', {
      actor: adminActorName(room, socket),
      leader: leaderName,
    });
    return ack(ok());
  });

  // -------------------------------------------------------------------------
  // room:leave / disconnect.
  // -------------------------------------------------------------------------
  socket.on('room:leave', async (_p, ack) => {
    await handleLeave(io, socket);
    return ack(ok());
  });

  socket.on('disconnect', async () => {
    await handleDisconnect(io, socket);
  });

  // Helper closures bound to this io.
  async function gameAction(
    s: AvalonSocket,
    ack: (r: Ack) => void,
    build: (playerId: string) => Parameters<typeof applyEvent>[2],
  ): Promise<void> {
    const room = currentRoom(s);
    if (!room) return ack(fail('NOT_IN_ROOM', 'Not in a room'));
    const pid = s.data.playerId;
    if (!pid) return ack(fail('NOT_IN_ROOM', 'No player id'));
    const res = await applyEvent(io, room, build(pid));
    if (!res.ok) return ack(fail(res.code, res.message));
    return ack(ok());
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function currentRoom(socket: AvalonSocket): RoomRuntime | undefined {
  const code = socket.data.code;
  return code ? gameStore.get(code) : undefined;
}

/** Mark a seat as unclaimed + offline and drop its socket binding. The seat
 *  itself stays in the roster. */
function releaseSeat(room: RoomRuntime, playerId: string): void {
  const member = room.members.get(playerId);
  if (member) {
    member.claimed = false;
    member.connected = false;
  }
  room.socketByPlayer.delete(playerId);
}

/**
 * Apply a host roster edit: reconcile the desired ordered name list against the
 * current seats. Seats already claimed by a player cannot be removed (the host
 * must kick first). Renames update in place; new names append as unclaimed
 * seats; trailing unclaimed seats beyond the new length are dropped.
 */
async function applyRoster(
  room: RoomRuntime,
  names: string[],
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const desired = names
    .slice(0, 10)
    .map((n, i) => gameStore.sanitizeName(n) || fallbackSeatName(i));

  const seats = gameStore.activePlayers(room); // ordered by seat
  // Refuse to drop a claimed seat.
  for (let i = desired.length; i < seats.length; i++) {
    if (seats[i]!.claimed) {
      return { ok: false, code: 'SEAT_CLAIMED', message: 'Cannot remove a claimed seat' };
    }
  }

  // Rename existing seats in place.
  for (let i = 0; i < Math.min(desired.length, seats.length); i++) {
    const seat = seats[i]!;
    if (seat.name !== desired[i]) {
      seat.name = desired[i]!;
      void prisma.player.update({ where: { id: seat.id }, data: { name: seat.name } }).catch(() => {});
    }
  }
  // Append new seats.
  for (let i = seats.length; i < desired.length; i++) {
    const id = gameStore.newPlayerId();
    room.members.set(id, {
      id,
      name: desired[i]!,
      seat: i,
      isSpectator: false,
      connected: false,
      claimed: false,
    });
    void prisma.player
      .create({
        data: { id, roomId: room.roomId, name: desired[i]!, seat: i, isSpectator: false, connected: false, claimed: false },
      })
      .catch((e) => console.error('[setRoster] create seat failed', e));
  }
  // Drop trailing unclaimed seats.
  for (let i = desired.length; i < seats.length; i++) {
    const seat = seats[i]!;
    room.members.delete(seat.id);
    room.socketByPlayer.delete(seat.id);
    void prisma.player.delete({ where: { id: seat.id } }).catch(() => {});
  }

  room.config.roster = desired;
  void prisma.room
    .update({ where: { id: room.roomId }, data: { config: room.config as unknown as object } })
    .catch(() => {});
  return { ok: true };
}

function sanitizeConfig(config: RoomConfig, roster: string[]): RoomConfig {
  return {
    maxPlayers: Math.min(10, Math.max(5, Math.floor(config.maxPlayers))),
    allowSpectators: Boolean(config.allowSpectators),
    allowMidJoin: Boolean(config.allowMidJoin),
    options: {
      oberon: Boolean(config.options?.oberon),
      mordred: Boolean(config.options?.mordred),
      morgana: Boolean(config.options?.morgana),
      percival: Boolean(config.options?.percival),
      ladyOfTheLake: Boolean(config.options?.ladyOfTheLake),
    },
    roster,
  };
}

/** A socket leaving or dropping just releases its seat — the seat stays in the
 *  roster (claimable again). Mid-game the engine is told the player went
 *  offline so the UI can show it. */
async function handleLeave(io: AvalonServer, socket: AvalonSocket): Promise<void> {
  const room = currentRoom(socket);
  const pid = socket.data.playerId;
  socket.data.playerId = undefined;
  socket.data.code = undefined;
  if (!room) return;
  room.spectatorSockets.delete(socket.id);
  if (!pid) {
    broadcastRoom(io, room);
    return;
  }

  releaseSeat(room, pid);
  void prisma.player
    .update({ where: { id: pid }, data: { claimed: false, connected: false } })
    .catch(() => {});
  if (room.game) {
    await applyEvent(io, room, { type: 'SET_CONNECTED', by: pid, connected: false });
  }
  broadcastRoom(io, room);
}

async function handleDisconnect(io: AvalonServer, socket: AvalonSocket): Promise<void> {
  const room = currentRoom(socket);
  if (!room) return;
  // Drop any spectator binding for this socket regardless of seat state.
  room.spectatorSockets.delete(socket.id);

  const pid = socket.data.playerId;
  if (!pid) return;
  // Only act if this socket is still the current one for the player (avoids
  // races where the player already reconnected on a new socket).
  if (room.socketByPlayer.get(pid) !== socket.id) return;

  const member = room.members.get(pid);
  if (room.status === 'lobby') {
    // Lobby drop: free the seat so someone else can claim it. Seat stays.
    releaseSeat(room, pid);
    void prisma.player
      .update({ where: { id: pid }, data: { claimed: false, connected: false } })
      .catch(() => {});
    broadcastRoom(io, room);
  } else {
    // Mid-game drop: keep the seat claimed, just mark offline (allow reconnect).
    if (member) member.connected = false;
    room.socketByPlayer.delete(pid);
    if (room.game) {
      await applyEvent(io, room, { type: 'SET_CONNECTED', by: pid, connected: false });
    }
    void prisma.player.update({ where: { id: pid }, data: { connected: false } }).catch(() => {});
    broadcastRoom(io, room);
  }
}
