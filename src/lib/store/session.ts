'use client';

import { sanitizeName } from '@/lib/game/displayName';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-room identity persisted in LocalStorage so a player can reconnect to the
 * same seat after a refresh or network drop. Keyed by room code.
 *
 * - `playerId` is the claimed seat's id (absent until the player claims a seat).
 * - `playerToken` proves ownership of that seat during reconnect.
 * - `hostToken` is the opaque owner token (present only in the creator's
 *   browser); whoever holds it is the room host.
 */
interface SessionEntry {
  playerId?: string;
  playerToken?: string;
  name?: string;
  hostToken?: string;
}

interface SessionState {
  sessions: Record<string, SessionEntry>; // room code → entry
  lastName: string;
  lastAvatarUrl?: string;
  setSession: (code: string, entry: Partial<SessionEntry>) => void;
  getSession: (code: string) => SessionEntry | undefined;
  clearSession: (code: string) => void;
  setLastName: (name: string) => void;
  setAccountIdentity: (name: string, avatarUrl?: string) => void;
  clearAccountAvatar: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      lastName: '',
      lastAvatarUrl: undefined,
      setSession: (code, entry) =>
        set((s) => {
          const normalized = entry.name === undefined ? entry : { ...entry, name: sanitizeName(entry.name) };
          const merged = { ...s.sessions[code], ...normalized };
          return {
            sessions: { ...s.sessions, [code]: merged },
            lastName: normalized.name || s.lastName,
          };
        }),
      getSession: (code) => get().sessions[code],
      clearSession: (code) =>
        set((s) => {
          const next = { ...s.sessions };
          delete next[code];
          return { sessions: next };
        }),
      // Choosing an anonymous name must not reuse a previous account avatar.
      setLastName: (name) => set({ lastName: sanitizeName(name), lastAvatarUrl: undefined }),
      setAccountIdentity: (name, avatarUrl) => set({ lastName: sanitizeName(name), lastAvatarUrl: avatarUrl }),
      clearAccountAvatar: () => set({ lastAvatarUrl: undefined }),
    }),
    { name: 'avalon-session' },
  ),
);
