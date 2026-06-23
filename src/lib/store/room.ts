'use client';

import { create } from 'zustand';
import type { ClientGameState, Role, Team, VisibilityInfo } from '@/lib/engine';
import type { PlayerId } from '@/lib/engine';
import type { RoomSnapshot } from '../socket/types';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

interface PrivateReveal {
  selfRole: Role;
  knownPlayers: VisibilityInfo[];
}

interface LadyResult {
  targetId: PlayerId;
  loyalty: Team;
}

interface RoomState {
  conn: ConnStatus;
  /**
   * The room code the current snapshot/game/identity belongs to. The store is a
   * process-global singleton that survives client-side navigation, so this tags
   * which room the held state is for — letting consumers ignore (and the
   * connection layer reset) state left over from a previously-visited room.
   */
  roomCode: string | null;
  myPlayerId: string | null;
  /** True if this client authenticated as the room host (owner token). */
  isHost: boolean;
  snapshot: RoomSnapshot | null;
  game: ClientGameState | null;
  reveal: PrivateReveal | null;
  ladyResult: LadyResult | null;
  notice: { type: string; message?: string } | null;
  /** This client's own round-trip latency in ms (null until first ping). */
  selfLatency: number | null;

  setConn: (c: ConnStatus) => void;
  setRoomCode: (code: string | null) => void;
  setMyPlayerId: (id: string | null) => void;
  setIsHost: (v: boolean) => void;
  setSnapshot: (s: RoomSnapshot) => void;
  setGame: (g: ClientGameState) => void;
  setReveal: (r: PrivateReveal) => void;
  setLadyResult: (r: LadyResult) => void;
  setNotice: (n: { type: string; message?: string } | null) => void;
  setSelfLatency: (ms: number | null) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  conn: 'connecting',
  roomCode: null,
  myPlayerId: null,
  isHost: false,
  snapshot: null,
  game: null,
  reveal: null,
  ladyResult: null,
  notice: null,
  selfLatency: null,

  setConn: (conn) => set({ conn }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyPlayerId: (myPlayerId) => set({ myPlayerId }),
  setIsHost: (isHost) => set({ isHost }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setGame: (game) => set({ game }),
  setReveal: (reveal) => set({ reveal }),
  setLadyResult: (ladyResult) => set({ ladyResult }),
  setNotice: (notice) => set({ notice }),
  setSelfLatency: (selfLatency) => set({ selfLatency }),
  reset: () =>
    set({
      roomCode: null,
      myPlayerId: null,
      isHost: false,
      snapshot: null,
      game: null,
      reveal: null,
      ladyResult: null,
      notice: null,
      selfLatency: null,
    }),
}));
