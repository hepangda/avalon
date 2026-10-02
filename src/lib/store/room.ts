import { create } from 'zustand';
import type { ClientGameState } from '@/lib/engine';
import type { RoomSnapshot, PlayerLatency } from '../socket/types';
import type { ViewSnapshot } from '../socket/stateIntegrity';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';
const initialRoom = {
  conn: 'connecting' as ConnStatus, syncing: true, recoveryRevision: 0,
  roomCode: null as string | null, myPlayerId: null as string | null,
  isHost: false, isReferee: false,
  snapshot: null as RoomSnapshot | null, game: null as ClientGameState | null,
  notice: null as { type: string; message?: string } | null,
  selfLatency: null as number | null,
};

interface RoomActions {
  setSyncing(syncing: boolean): void;
  applyView(snapshot: ViewSnapshot, recovery: boolean): void;
  setConn(conn: ConnStatus): void;
  setRoomCode(code: string | null): void;
  setIsHost(value: boolean): void;
  setIsReferee(value: boolean): void;
  setNotice(notice: typeof initialRoom.notice): void;
  setSelfLatency(ms: number | null): void;
  setPlayerLatency(update: PlayerLatency): void;
  reset(): void;
}

/** One authoritative view. Private identity/results are read directly from game. */
export const useRoomStore = create<typeof initialRoom & RoomActions>((set) => ({
  ...initialRoom,
  setSyncing: (syncing) => set({ syncing }),
  applyView: ({ view }, recovery) => set((state) => ({
    roomCode: view.room.code, snapshot: view.room, game: view.game,
    myPlayerId: view.playerId, isHost: view.isHost, isReferee: view.isReferee,
    syncing: false, recoveryRevision: state.recoveryRevision + (recovery ? 1 : 0),
  })),
  setConn: (conn) => set(conn === 'connected' ? { conn } : { conn, isReferee: false }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setIsHost: (isHost) => set({ isHost }),
  setIsReferee: (isReferee) => set({ isReferee }),
  setNotice: (notice) => set({ notice }),
  setSelfLatency: (selfLatency) => set({ selfLatency }),
  setPlayerLatency: ({ playerId, latency }) => set((state) => {
    const snapshot = state.snapshot?.members.some((m) => m.id === playerId && m.latency !== latency)
      ? { ...state.snapshot, members: state.snapshot.members.map((m) => m.id === playerId ? { ...m, latency } : m) }
      : state.snapshot;
    const game = state.game?.players.some((p) => p.id === playerId && p.latency !== latency)
      ? { ...state.game, players: state.game.players.map((p) => p.id === playerId ? { ...p, latency } : p) }
      : state.game;
    return snapshot === state.snapshot && game === state.game ? state : { snapshot, game };
  }),
  reset: () => set({ ...initialRoom }),
}));
