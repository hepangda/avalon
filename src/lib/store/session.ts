'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-room identity persisted in LocalStorage so a player can reconnect to the
 * same seat after a refresh or network drop. Keyed by room code.
 *
 * - `playerId` is the claimed seat's id (absent until the player claims a seat).
 * - `hostToken` is the opaque owner token (present only in the creator's
 *   browser); whoever holds it is the room host.
 */
interface SessionEntry {
  playerId?: string;
  name?: string;
  hostToken?: string;
}

interface SessionState {
  sessions: Record<string, SessionEntry>; // code (upper) → entry
  lastName: string;
  setSession: (code: string, entry: Partial<SessionEntry>) => void;
  getSession: (code: string) => SessionEntry | undefined;
  clearSession: (code: string) => void;
  setLastName: (name: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      lastName: '',
      setSession: (code, entry) =>
        set((s) => {
          const key = code.toUpperCase();
          const merged = { ...s.sessions[key], ...entry };
          return {
            sessions: { ...s.sessions, [key]: merged },
            lastName: entry.name || s.lastName,
          };
        }),
      getSession: (code) => get().sessions[code.toUpperCase()],
      clearSession: (code) =>
        set((s) => {
          const next = { ...s.sessions };
          delete next[code.toUpperCase()];
          return { sessions: next };
        }),
      setLastName: (name) => set({ lastName: name }),
    }),
    { name: 'avalon-session' },
  ),
);
