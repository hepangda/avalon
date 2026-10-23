import { useEffect, useState } from 'react';
import type { SeatRecord } from './historyTypes';

const FRESH_MS = 60_000;
// Reopening a seat within a minute shows its plate at once.
const cache = new Map<string, { at: number; record: SeatRecord | null }>();

/** A tablemate's public plate; null once the seat is known to have none. */
export function useSeatRecord(code: string, playerId: string, enabled: boolean) {
  const key = `${code}:${playerId}`;
  const cached = cache.get(key);
  const fresh = !!cached && Date.now() - cached.at < FRESH_MS;
  const [state, setState] = useState<{ key: string; record?: SeatRecord | null; failed: boolean }>(
    { key, record: fresh ? cached.record : undefined, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const hit = cache.get(key);
    if (!enabled || (hit && Date.now() - hit.at < FRESH_MS)) {
      setState({ key, record: hit?.record, failed: false });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ key, record: current.key === key ? current.record : undefined, failed: false }));
    fetch(`/api/rooms/${encodeURIComponent(code)}/players/${encodeURIComponent(playerId)}/record`,
      { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<SeatRecord>;
      })
      .then((record) => {
        cache.set(key, { at: Date.now(), record });
        setState({ key, record, failed: false });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ key, failed: true }); });
    return () => controller.abort();
  }, [code, playerId, key, enabled, attempt]);
  const current = state.key === key ? state : { record: undefined, failed: false };
  return { record: current.record, failed: current.failed, retry: () => setAttempt((n) => n + 1) };
}
