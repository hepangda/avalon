import { useEffect, useRef } from 'react';
import { playSound, type PlayOptions, type SoundName } from './engine';

/**
 * Plays `cue` whenever it (or `key`) changes to something new. Presentation components pass the
 * cue for their current stage, so the sound follows the animation without touching game logic.
 */
export function useSoundCue(cue: SoundName | null | undefined | false, options: PlayOptions & { key?: string | number } = {}) {
  const { key, delay, count, interval } = options;
  const last = useRef<string | null>(null);
  useEffect(() => {
    const id = cue ? `${cue}|${key ?? ''}` : null;
    // Refs survive StrictMode's replayed effect, so a stage plays once.
    if (id === last.current) return;
    last.current = id;
    if (cue) playSound(cue, { delay, count, interval });
  }, [cue, key, delay, count, interval]);
}
