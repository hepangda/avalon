import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack } from '@/lib/socket/types';

/** Only in-flight work is optimistic; submitted state always comes from the server. */
export function useRoomAction(key: string, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    running.current = false;
    setBusy(false);
    setError(null);
    return () => {
      revision.current++;
    };
  }, [key]);
  const run = useCallback(
    async (action: () => Promise<Ack<unknown>>) => {
      if (running.current) return false;
      running.current = true;
      const token = ++revision.current;
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (revision.current !== token) return false;
        if (!result.ok) setError(result.error?.message ?? fallback);
        return result.ok;
      } catch {
        if (revision.current === token) setError(fallback);
        return false;
      } finally {
        if (revision.current === token) {
          running.current = false;
          setBusy(false);
        }
      }
    },
    [fallback],
  );
  return { busy, error, run, clearError: () => setError(null) };
}
