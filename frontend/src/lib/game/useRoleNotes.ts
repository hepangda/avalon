import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getConnection } from '@/lib/socket/client/socket';
import {
  readRoleNotes,
  readRoleNotesEnabled,
  type RoleNotesDocument,
  type RoleNotesScope,
} from './roleNotes';
import { readPendingNoteOperations, RoleNotesSync } from './roleNotesSync';

/** Local cache remains usable offline; only seated live games sync to the room. */
export function useRoleNotes(
  key: string | null,
  room?: { code: string; connected: boolean } & RoleNotesScope,
) {
  const controller = useMemo(() => {
    let initial = { notes: {}, enabled: true };
    let pending = readPendingNoteOperations(null);
    try {
      if (key) {
        initial = {
          notes: readRoleNotes(key, window.localStorage),
          enabled: readRoleNotesEnabled(key, window.localStorage),
        };
        pending = readPendingNoteOperations(
          window.localStorage.getItem(`${key}:pending`),
        );
      }
    } catch {
      /* Storage may be unavailable; still allow in-memory notes. */
    }
    return new RoleNotesSync(initial, pending, (value, operations) => {
      if (!key) return;
      // Intent first: refreshing during a save must not lose pending edits.
      window.localStorage.setItem(`${key}:pending`, JSON.stringify(operations));
      window.localStorage.setItem(key, JSON.stringify(value.notes));
      window.localStorage.setItem(`${key}:show-known`, String(value.enabled));
    });
  }, [key]);
  const value = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const code = room?.code;
  const connected = room?.connected;
  const gameId = room?.gameId;
  const roleRevision = room?.roleRevision;
  const playerId = room?.playerId;

  useEffect(() => {
    if (
      !connected ||
      !code ||
      !gameId ||
      roleRevision === undefined ||
      !playerId
    )
      return;
    let stopped = false;
    const scope = { gameId, roleRevision, playerId };
    const flush = () =>
      controller.sync(scope, async (request) => {
        const connection = getConnection();
        if (stopped || connection?.code !== code || !connection.connected)
          return { ok: false };
        return connection.emit<RoleNotesDocument>('notes:sync', request);
      });
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = controller.subscribe(() => {
      if (!controller.hasPending) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => void flush(), 750);
    });
    const onVisibility = () => {
      void flush();
    };
    const interval = setInterval(() => void flush(), 5000);
    window.addEventListener('pagehide', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    void flush();
    return () => {
      void flush();
      stopped = true;
      unsubscribe();
      clearInterval(interval);
      clearTimeout(debounce);
      window.removeEventListener('pagehide', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [controller, code, connected, gameId, roleRevision, playerId]);

  return {
    ...value,
    setNote: controller.setNote,
    clearNotes: controller.clearNotes,
    setEnabled: controller.setEnabled,
  };
}
