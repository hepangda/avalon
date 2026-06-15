'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomStore } from '@/lib/store/room';
import { decideCue, type ActiveCue, type CueCounts } from './cueLogic';

/**
 * Watches game state and surfaces a result cue when a vote resolves or a
 * mission completes. The cue stays until the player dismisses it (manual
 * close) — it does not block play (the overlay is non-blocking) but is not
 * auto-dismissed.
 *
 * Reconnect-safe via decideCue: the first observation records a baseline so a
 * freshly-synced full history never replays past cues. If multiple results
 * arrive while a cue is open, the latest wins.
 */
export function useResultCue(): { cue: ActiveCue | null; dismiss: () => void } {
  const game = useRoomStore((s) => s.game);
  const [cue, setCue] = useState<ActiveCue | null>(null);
  const seen = useRef<CueCounts | null>(null);

  useEffect(() => {
    if (!game) return;
    const { cue: nextCue, next } = decideCue(seen.current, game);
    seen.current = next;
    if (nextCue) setCue(nextCue);
  }, [game]);

  const dismiss = useCallback(() => setCue(null), []);

  return { cue, dismiss };
}
