'use client';

import { ViewSynchronizer } from './viewSync';
import type { HeartbeatState, ViewSnapshot } from '../stateIntegrity';

import { useEffect } from 'react';
import { gameImageUrls, preloadImages } from '@/lib/game/preloadImages';
import { useCardArtStore } from '@/lib/store/cardArt';
import { connectRoom, emitWithAck, getConnection, type ConnState } from './socket';
import { createLatencyHeartbeat } from './heartbeat';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import type { Ack, PlayerLatency, RoomConfig } from '../types';

/**
 * Connect to a room and keep the room store in sync. Handles initial join and
 * automatic reconnect. The signed-in account restores its existing seat and
 * host status across devices; local tokens support older room snapshots.
 * New players still choose a seat through `room:claimSeat`.
 */
export function useRoomConnection(code: string | null) {
  const { user, loading, refresh } = useAuthIdentity();
  const cardArtStyle = useCardArtStore((state) => state.style);
  useEffect(() => {
    if (!code) return;
    const preload = () => preloadImages(gameImageUrls(cardArtStyle));
    preload();
    window.addEventListener('online', preload);
    return () => window.removeEventListener('online', preload);
  }, [code, cardArtStyle]);
  useEffect(() => {
    if (!code || loading || !user) return;
    const roomCode = code;

    // The room store is a process-global singleton that survives client-side
    // navigation. If it still holds another room's state (e.g. a finished
    // game's GameOver snapshot), clear it before we connect so the stale state
    // can't leak into this room — otherwise a leftover `status: 'finished'`
    // snapshot or `phase: 'GameOver'` game could trigger a wrong redirect or
    // render the previous game's end screen.
    if (useRoomStore.getState().roomCode !== roomCode) {
      useRoomStore.getState().reset();
      useRoomStore.getState().setRoomCode(roomCode);
    }
    const store = useRoomStore.getState();
    let active = true;
    let sync: ViewSynchronizer;
    function newSynchronizer() {
      return new ViewSynchronizer({
        code: roomCode,
        read: () => {
          const state = useRoomStore.getState();
          return state.snapshot && state.roomCode === roomCode ? {
            room: state.snapshot, game: state.game, playerId: state.myPlayerId,
            isHost: state.isHost, isReferee: state.isReferee,
          } : null;
        },
        apply: (snapshot, recovery) => { if (active) store.applyView(snapshot, recovery); },
        invalidate: () => { if (active) store.setSyncing(true); },
        request: () => {
          const connection = getConnection();
          return active && connection?.code === roomCode && connection.connected
            ? connection.emit('room:resync', {}) : Promise.resolve();
        },
      });
    }
    sync = newSynchronizer();

    async function doJoin() {
      const joiningSync = sync;
      const session = useSessionStore.getState().getSession(roomCode);
      try {
        const res = await emitWithAck<
          'room:join',
          { code: string; playerId?: string; playerToken?: string; hostToken?: string; syncVersion: 1 },
          Ack<{ playerId?: string; playerToken?: string; isHost: boolean }>
        >('room:join', {
          code: roomCode,
          syncVersion: 1,
          playerId: session?.playerId,
          playerToken: session?.playerToken,
          hostToken: session?.hostToken,
        });
        if (!active || sync !== joiningSync) return;
        if (res.ok && res.data) {
          useSessionStore.getState().setSession(roomCode, {
            playerId: res.data.playerId, playerToken: res.data.playerToken,
          });
        } else if (res.error) {
          store.setNotice({ type: 'join_error', message: res.error.message });
        }
      } catch {
        store.setNotice({ type: 'join_error', message: 'Could not reach the server' });
      }
    }

    // Latency heartbeat: time the ack round-trip, store it locally, and report
    // the previous measurement so the server can share it with the room.
    const heartbeat = createLatencyHeartbeat(
      async (rtt) => {
        const conn = getConnection();
        return conn?.connected ? conn.emit<HeartbeatState>('net:ping', { rtt }) : { ok: false };
      },
      store.setSelfLatency,
      (result) => { if (active && result.ok) void sync.check((result.data as HeartbeatState | undefined)?.sync ?? null); },
    );
    function ping() {
      if (getConnection()?.connected) void heartbeat.ping();
    }

    function onNotice(n: { type: string; message?: string }) {
      // Being kicked (host) or unbound (referee) frees our seat server-side; drop
      // the local seat identity so the "who are you?" picker reloads to an
      // unclaimed state instead of still highlighting our old seat.
      if (n.type === 'kicked' || n.type === 'unbound' || n.type === 'session_replaced') {
        sync.dispose();
        if (n.type !== 'session_replaced') sync = newSynchronizer();
        store.setSyncing(true);
        useRoomStore.setState({ myPlayerId: null, game: null, reveal: null, ladyResult: null });
        useSessionStore
          .getState()
          .setSession(roomCode, { playerId: undefined, playerToken: undefined });
      }
      if (n.type === 'session_replaced') {
        sync.dispose();
        heartbeat.reset();
        store.setSyncing(true);
        store.setConn('disconnected');
        store.setIsHost(false);
        store.setIsReferee(false);
        getConnection()?.close();
        useRoomStore.setState({ game: null, reveal: null, ladyResult: null });
        store.setNotice(n);
        return;
      }
      store.setNotice(n);
    }

    function onPush(event: string, payload: unknown) {
      switch (event) {
        case 'view:sync':
          void sync.receive(payload as ViewSnapshot);
          break;
        case 'net:latency':
          store.setPlayerLatency(payload as PlayerLatency);
          break;
        case 'system:notice':
          onNotice(payload as { type: string; message?: string });
          break;
        default:
          break;
      }
    }

    function onState(s: ConnState) {
      if (!active) return;
      if (s === 'connected') {
        store.setSyncing(true);
        store.setConn('connected');
        void doJoin(); // (re)join on every (re)connect
        void ping();
      } else if (s === 'connecting') {
        sync.dispose();
        sync = newSynchronizer();
        store.setSyncing(true);
        heartbeat.reset();
        store.setConn('connecting');
        store.setSelfLatency(null);
      } else {
        sync.dispose();
        store.setSyncing(true);
        heartbeat.reset();
        store.setConn('disconnected');
        useRoomStore.getState().setSelfLatency(null);
        // A rejected upgrade can mean the login cookie expired. Refreshing the
        // account lets the route show sign-in instead of reconnecting forever.
        void refresh();
      }
    }

    const connection = connectRoom(roomCode, { onState, onPush });
    // A room connection survives lobby/game navigation; reinstall synchronization immediately.
    if (connection.connected) onState('connected');
    const pingTimer = setInterval(() => void ping(), 4000);
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      sync.dispose();
      clearInterval(pingTimer);
      document.removeEventListener('visibilitychange', onVisible);
      heartbeat.dispose();
      // Detach this effect's handlers so its closures can't write to the store
      // after unmount. The connection itself persists across navigation (e.g.
      // lobby → game reuse it); the next consumer re-attaches via connectRoom.
      getConnection()?.setHandlers({});
    };
  }, [code, loading, user?.id, refresh]);
}

/** Thin typed wrappers around emitWithAck for room/game actions. */
export const roomActions = {
  config: (config: RoomConfig) =>
    emitWithAck<'room:config', { config: RoomConfig }, Ack>('room:config', { config }),
  rename: (name: string) =>
    emitWithAck<'room:rename', { name: string }, Ack<{ name: string }>>('room:rename', { name }),
  addBot: () => emitWithAck<'room:addBot', Record<string, never>, Ack>('room:addBot', {}),
  kick: (targetPlayerId: string) =>
    emitWithAck<'room:kick', { targetPlayerId: string }, Ack>('room:kick', { targetPlayerId }),
  transferHost: (targetPlayerId: string) =>
    emitWithAck<'room:transferHost', { targetPlayerId: string }, Ack>('room:transferHost', {
      targetPlayerId,
    }),
  claimSeat: (seatId?: string, name?: string, avatarUrl?: string) =>
    emitWithAck<
      'room:claimSeat',
      { seatId?: string; name?: string; avatarUrl?: string },
      Ack<{ playerId: string; playerToken: string }>
    >('room:claimSeat', {
      seatId,
      ...(name?.trim() ? { name } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    }),
  releaseSeat: () =>
    emitWithAck<'room:releaseSeat', Record<string, never>, Ack>('room:releaseSeat', {}),
  setRoster: (names: string[]) =>
    emitWithAck<'room:setRoster', { names: string[] }, Ack>('room:setRoster', { names }),
  start: () => emitWithAck<'room:start', Record<string, never>, Ack>('room:start', {}),
  restart: () => emitWithAck<'room:restart', Record<string, never>, Ack>('room:restart', {}),
  removeSeat: (seatId: string) =>
    emitWithAck<'room:removeSeat', { seatId: string }, Ack>('room:removeSeat', { seatId }),
  leave: () => emitWithAck<'room:leave', Record<string, never>, Ack>('room:leave', {}),
};

/** Game-phase action wrappers. */
export const gameActions = {
  useRerollCard: (roleRevision: number) =>
    emitWithAck<'game:useRerollCard', { roleRevision: number }, Ack>('game:useRerollCard', { roleRevision }),
  ackRole: (roleRevision = 0) =>
    emitWithAck<'game:ackRole', { roleRevision: number }, Ack>('game:ackRole', { roleRevision }),
  proposeTeam: (team: string[]) =>
    emitWithAck<'game:proposeTeam', { team: string[] }, Ack>('game:proposeTeam', { team }),
  finalizeTeam: (team: string[]) =>
    emitWithAck<'game:finalizeTeam', { team: string[] }, Ack>('game:finalizeTeam', { team }),
  startDiscussion: (direction: 'clockwise' | 'counterclockwise' = 'clockwise') =>
    emitWithAck<'game:startDiscussion', { direction: 'clockwise' | 'counterclockwise' }, Ack>('game:startDiscussion', { direction }),
  endSpeech: () =>
    emitWithAck<'game:endSpeech', Record<string, never>, Ack>('game:endSpeech', {}),
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
  startAssassination: () =>
    emitWithAck<'game:startAssassination', Record<string, never>, Ack>('game:startAssassination', {}),
  assassinate: (targetPlayerId: string) =>
    emitWithAck<'game:assassinate', { targetPlayerId: string }, Ack>('game:assassinate', {
      targetPlayerId,
    }),
};

/** Referee (admin) action wrappers. */
export const adminActions = {
  setTimersPaused: (paused: boolean) =>
    emitWithAck<'admin:setTimersPaused', { paused: boolean }, Ack>('admin:setTimersPaused', { paused }),
  skipSpeech: (targetPlayerId: string) =>
    emitWithAck<'admin:skipSpeech', { targetPlayerId: string }, Ack>('admin:skipSpeech', { targetPlayerId }),
  rerollLeader: () =>
    emitWithAck<'admin:rerollLeader', Record<string, never>, Ack>('admin:rerollLeader', {}),
  rerollRoles: () =>
    emitWithAck<'admin:rerollRoles', Record<string, never>, Ack>('admin:rerollRoles', {}),
  startAssassination: () =>
    emitWithAck<'admin:startAssassination', Record<string, never>, Ack>('admin:startAssassination', {}),
  previousPhase: () =>
    emitWithAck<'admin:previousPhase', Record<string, never>, Ack>('admin:previousPhase', {}),
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
