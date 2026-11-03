import { useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { ClientGameState } from '@/lib/engine';
import { beatSnapshot, phaseBeats, type BeatSnapshot, type PhaseBeatSet } from './phaseBeats';
import { newTablePresentations } from './tablePresentation';

/** How long a beat may hold the table's attention; the server is never kept waiting. */
export const BEAT_MS = 1100;

/**
 * Diff the table the viewer can see against the last one they saw. `held`
 * covers reveals and the role deal: the table underneath keeps changing, but
 * the beat waits until the felt is the player's again.
 */
export function usePhaseBeats(game: ClientGameState | null, myPlayerId: string | null, held: boolean): PhaseBeatSet | null {
  const reduceMotion = useReducedMotion();
  const last = useRef<BeatSnapshot | null>(null);
  const lastGame = useRef<ClientGameState | null>(null);
  const serial = useRef(0);
  const [beat, setBeat] = useState<PhaseBeatSet | null>(null);
  // The first quest opens once the whole table has confirmed, not when the viewer has.
  const opening = !!game && (game.rolesPending || (!!myPlayerId && !game.isSpectator && !game.roleAcks.includes(myPlayerId)));
  const hold = held || opening;
  useLayoutEffect(() => {
    const previousGame = lastGame.current;
    lastGame.current = game;
    if (!game) {
      last.current = null;
      setBeat(null);
      return;
    }
    // The reveal queue only learns of this state after this render, so ask it directly.
    if (hold || newTablePresentations(previousGame, game).length > 0) {
      // A reveal interrupts whatever beat was still playing.
      setBeat(null);
      // Remember that the table has not opened yet, so its first quest gets its card.
      if (!last.current && opening) last.current = beatSnapshot(game, true);
      return;
    }
    const next = beatSnapshot(game, false);
    const beats = reduceMotion ? [] : phaseBeats(last.current, next, game);
    last.current = next;
    if (beats.length) setBeat({ id: `${next.timeline}-${++serial.current}`, beats });
  }, [game, hold, opening, reduceMotion]);
  useLayoutEffect(() => {
    if (!beat) return;
    const timer = setTimeout(() => setBeat((current) => (current === beat ? null : current)), BEAT_MS);
    return () => clearTimeout(timer);
  }, [beat]);
  return beat;
}
