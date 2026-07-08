'use client';

import { useEffect } from 'react';
import { connectRoom, emitWithAck, getConnection, type ConnState } from './socket';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import type { ClientGameState, PlayerId, Role, Team, VisibilityInfo } from '@/lib/engine';
import type { Ack, RoomConfig, RoomSnapshot } from '../types';

/**
 * Connect to a room and keep the room store in sync. Handles initial join and
 * automatic reconnect. On every (re)connect it re-sends `room:join` with the
 * persisted hostToken (owner identity) and playerId (a previously-claimed
 * seat), so a refresh or network drop restores host status and the seat.
 *
 * Joining does NOT take a seat — the seat picker drives `room:claimSeat`.
 */
export function useRoomConnection(code: string | null) {
  useEffect(() => {
    if (!code) return;
    const upperCode = code.toUpperCase();

    // The room store is a process-global singleton that survives client-side
    // navigation. If it still holds another room's state (e.g. a finished
    // game's GameOver snapshot), clear it before we connect so the stale state
    // can't leak into this room — otherwise a leftover `status: 'finished'`
    // snapshot or `phase: 'GameOver'` game could trigger a wrong redirect or
    // render the previous game's end screen.
    if (useRoomStore.getState().roomCode !== upperCode) {
      useRoomStore.getState().reset();
      useRoomStore.getState().setRoomCode(upperCode);
    }
    const store = useRoomStore.getState();

    async function doJoin() {
      const session = useSessionStore.getState().getSession(upperCode);
      try {
        const res = await emitWithAck<
          'room:join',
          { code: string; playerId?: string; hostToken?: string },
          Ack<{ playerId?: string; isHost: boolean }>
        >('room:join', {
          code: upperCode,
          playerId: session?.playerId,
          hostToken: session?.hostToken,
        });
        if (res.ok && res.data) {
          useRoomStore.getState().setIsHost(res.data.isHost);
          if (res.data.playerId) {
            store.setMyPlayerId(res.data.playerId);
            useSessionStore.getState().setSession(upperCode, { playerId: res.data.playerId });
          }
        } else if (res.error) {
          store.setNotice({ type: 'join_error', message: res.error.message });
        }
      } catch {
        store.setNotice({ type: 'join_error', message: 'Could not reach the server' });
      }
    }

    // Latency heartbeat: time the ack round-trip, store it locally, and report
    // the previous measurement so the server can share it with the room.
    let lastRtt: number | undefined;
    async function ping() {
      const conn = getConnection();
      if (!conn?.connected) return;
      const sent = performance.now();
      await conn.emit('net:ping', { rtt: lastRtt });
      lastRtt = Math.round(performance.now() - sent);
      useRoomStore.getState().setSelfLatency(lastRtt);
    }

    function onNotice(n: { type: string; message?: string }) {
      // Being kicked (host) or unbound (referee) frees our seat server-side; drop
      // the local seat identity so the "who are you?" picker reloads to an
      // unclaimed state instead of still highlighting our old seat.
      if (n.type === 'kicked' || n.type === 'unbound') {
        useRoomStore.getState().setMyPlayerId(null);
        useSessionStore.getState().setSession(upperCode, { playerId: undefined });
      }
      store.setNotice(n);
    }

    function onPush(event: string, payload: unknown) {
      switch (event) {
        case 'room:snapshot':
          store.setSnapshot(payload as RoomSnapshot);
          break;
        case 'state:sync':
          store.setGame(payload as ClientGameState);
          break;
        case 'private:reveal':
          store.setReveal(payload as { selfRole: Role; knownPlayers: VisibilityInfo[] });
          break;
        case 'private:lady':
          store.setLadyResult(payload as { targetId: PlayerId; loyalty: Team });
          break;
        case 'system:notice':
          onNotice(payload as { type: string; message?: string });
          break;
        default:
          break;
      }
    }

    function onState(s: ConnState) {
      if (s === 'connected') {
        store.setConn('connected');
        void doJoin(); // (re)join on every (re)connect
        void ping();
      } else if (s === 'connecting') {
        store.setConn('connecting');
      } else {
        store.setConn('disconnected');
        useRoomStore.getState().setSelfLatency(null);
      }
    }

    connectRoom(upperCode, { onState, onPush });
    const pingTimer = setInterval(() => void ping(), 4000);

    return () => {
      clearInterval(pingTimer);
      // Detach this effect's handlers so its closures can't write to the store
      // after unmount. The connection itself persists across navigation (e.g.
      // lobby → game reuse it); the next consumer re-attaches via connectRoom.
      getConnection()?.setHandlers({});
    };
  }, [code]);
}

/** Thin typed wrappers around emitWithAck for room/game actions. */
export const roomActions = {
  config: (config: RoomConfig) =>
    emitWithAck<'room:config', { config: RoomConfig }, Ack>('room:config', { config }),
  rename: (name: string) =>
    emitWithAck<'room:rename', { name: string }, Ack<{ name: string }>>('room:rename', { name }),
  kick: (targetPlayerId: string) =>
    emitWithAck<'room:kick', { targetPlayerId: string }, Ack>('room:kick', { targetPlayerId }),
  transferHost: (targetPlayerId: string) =>
    emitWithAck<'room:transferHost', { targetPlayerId: string }, Ack>('room:transferHost', {
      targetPlayerId,
    }),
  claimSeat: (seatId: string) =>
    emitWithAck<'room:claimSeat', { seatId: string }, Ack<{ playerId: string }>>('room:claimSeat', {
      seatId,
    }),
  releaseSeat: () =>
    emitWithAck<'room:releaseSeat', Record<string, never>, Ack>('room:releaseSeat', {}),
  setRoster: (names: string[]) =>
    emitWithAck<'room:setRoster', { names: string[] }, Ack>('room:setRoster', { names }),
  start: () => emitWithAck<'room:start', Record<string, never>, Ack>('room:start', {}),
  leave: () => emitWithAck<'room:leave', Record<string, never>, Ack>('room:leave', {}),
};

/** Game-phase action wrappers. */
export const gameActions = {
  ackRole: () => emitWithAck<'game:ackRole', Record<string, never>, Ack>('game:ackRole', {}),
  proposeTeam: (team: string[]) =>
    emitWithAck<'game:proposeTeam', { team: string[] }, Ack>('game:proposeTeam', { team }),
  vote: (value: 'approve' | 'reject') =>
    emitWithAck<'game:vote', { value: 'approve' | 'reject' }, Ack>('game:vote', { value }),
  missionCard: (card: 'success' | 'fail') =>
    emitWithAck<'game:missionCard', { card: 'success' | 'fail' }, Ack>('game:missionCard', {
      card,
    }),
  useLady: (targetPlayerId: string) =>
    emitWithAck<'game:useLady', { targetPlayerId: string }, Ack>('game:useLady', {
      targetPlayerId,
    }),
  assassinate: (targetPlayerId: string) =>
    emitWithAck<'game:assassinate', { targetPlayerId: string }, Ack>('game:assassinate', {
      targetPlayerId,
    }),
};

/** Referee (admin) action wrappers. */
export const adminActions = {
  auth: () =>
    emitWithAck<'admin:auth', Record<string, never>, Ack<{ ok: boolean }>>('admin:auth', {}),
  close: () => emitWithAck<'admin:close', Record<string, never>, Ack>('admin:close', {}),
  unbind: (targetPlayerId: string) =>
    emitWithAck<'admin:unbind', { targetPlayerId: string }, Ack>('admin:unbind', {
      targetPlayerId,
    }),
  vote: (targetPlayerId: string, value: 'approve' | 'reject') =>
    emitWithAck<'admin:vote', { targetPlayerId: string; value: 'approve' | 'reject' }, Ack>(
      'admin:vote',
      { targetPlayerId, value },
    ),
  propose: (targetPlayerId: string, team: string[]) =>
    emitWithAck<'admin:propose', { targetPlayerId: string; team: string[] }, Ack>('admin:propose', {
      targetPlayerId,
      team,
    }),
  retractVotes: () =>
    emitWithAck<'admin:retractVotes', Record<string, never>, Ack>('admin:retractVotes', {}),
  retractProposal: () =>
    emitWithAck<'admin:retractProposal', Record<string, never>, Ack>('admin:retractProposal', {}),
};
