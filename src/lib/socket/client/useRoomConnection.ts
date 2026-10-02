import type { HeartbeatState,ViewSnapshot } from '../stateIntegrity';
import { ViewSynchronizer } from './viewSync';

import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { gameImageUrls,preloadImages } from '@/lib/game/preloadImages';
import { useCardArtStore } from '@/lib/store/cardArt';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { useEffect } from 'react';
import type { PlayerLatency } from '../types';
import { createLatencyHeartbeat } from './heartbeat';
import { connectRoom,emitWithAck,getConnection,type ConnState } from './socket';

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
        const res = await emitWithAck('room:join', {
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
        useRoomStore.setState({ myPlayerId: null, game: null });
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
        useRoomStore.setState({ game: null });
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
