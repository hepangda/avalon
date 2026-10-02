'use client';

import { sanitizeName } from '@/lib/game/displayName';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-room identity persisted in LocalStorage so a player can reconnect to the
 * same seat after a refresh or network drop. Keyed by room code.
 *
 * - `playerId` is the claimed seat's id (absent until the player claims a seat).
 * - `playerToken` supports reconnecting to legacy seats without account bindings.
 * - `hostToken` supports legacy room ownership; current rooms use the account.
 * A valid account session is always required in addition to these tokens.
 */
interface SessionEntry {
  playerId?: string;
  playerToken?: string;
  name?: string;
  hostToken?: string;
}

interface SessionState {
  sessions: Record<string, SessionEntry>; // room code → entry
  setSession: (code: string, entry: Partial<SessionEntry>) => void;
  getSession: (code: string) => SessionEntry | undefined;
  clearSession: (code: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      setSession: (code, entry) =>
        set((s) => {
          const normalized = entry.name === undefined ? entry : { ...entry, name: sanitizeName(entry.name) };
          const merged = { ...s.sessions[code], ...normalized };
          return {
            sessions: { ...s.sessions, [code]: merged },
          };
        }),
      getSession: (code) => get().sessions[code],
      clearSession: (code) =>
        set((s) => {
          const next = { ...s.sessions };
          delete next[code];
          return { sessions: next };
        }),
    }),
    {
      name: 'avalon-session',
      version: 1,
      // Keep reconnect tokens, but permanently discard the old local identity.
      migrate: (stored) => ({ sessions: (stored as Partial<SessionState> | null)?.sessions ?? {} }),
      partialize: ({ sessions }) => ({ sessions }),
      merge: (stored, current) => ({
        ...current,
        sessions: (stored as Partial<SessionState> | null)?.sessions ?? {},
      }),
    },
  ),
);
