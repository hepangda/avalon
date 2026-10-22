import { useSoundStore } from '@/lib/store/sound';
import { renderSound, SOUND_NAMES, type SoundName } from './recipes';

export type { SoundName } from './recipes';

export interface PlayOptions {
  /** Seconds before the first hit. */
  delay?: number;
  /** Repeat the cue, e.g. one flick per dealt card. */
  count?: number;
  /** Seconds between repeats. */
  interval?: number;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const pending = new Map<SoundName, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<SoundName, number>();

/** Loudness reads as roughly the square of the slider, so the low half stays usable. */
export function masterGain(volume: number, muted: boolean) {
  return muted ? 0 : volume * volume;
}

function applyVolume() {
  if (!ctx || !master) return;
  const { volume, muted } = useSoundStore.getState();
  master.gain.setTargetAtTime(masterGain(volume, muted), ctx.currentTime, 0.02);
}

function load(name: SoundName) {
  if (!ctx) return Promise.resolve(null);
  let job = pending.get(name);
  if (!job) {
    job = renderSound(name, ctx.sampleRate)
      .then((buffer) => { buffers.set(name, buffer); return buffer; })
      .catch(() => null);
    pending.set(name, job);
  }
  return job;
}

/**
 * Browsers only let audio start from a gesture, so the context is created on the first tap or key
 * and resumed again on later ones (iOS suspends it whenever the page goes to the background).
 */
function unlock() {
  if (!ctx) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      ctx = new Context({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
    useSoundStore.subscribe(applyVolume);
    for (const name of SOUND_NAMES) void load(name);
  }
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const)
    window.addEventListener(type, unlock, { capture: true, passive: true });
}

function start(buffer: AudioBuffer, at: number) {
  if (!ctx || !master) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(master);
  src.start(at);
}

/** Fire and forget. Silent before the first gesture, while muted, and in a background tab. */
export function playSound(name: SoundName, { delay = 0, count = 1, interval = 0.1 }: PlayOptions = {}) {
  if (!ctx || ctx.state !== 'running' || typeof document === 'undefined' || document.hidden) return;
  const { muted, volume } = useSoundStore.getState();
  if (muted || volume === 0) return;
  // The same cue twice in one frame is a double mount, not a second event.
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < 40) return;
  lastPlayed.set(name, now);
  const schedule = (buffer: AudioBuffer, late: number) => {
    const at = ctx!.currentTime + Math.max(0, delay - late);
    for (let i = 0; i < count; i++) start(buffer, at + i * interval);
  };
  const ready = buffers.get(name);
  if (ready) return schedule(ready, 0);
  // Still rendering: play it if it is ready soon enough to belong to the moment.
  void load(name).then((buffer) => {
    const late = (performance.now() - now) / 1000;
    if (buffer && late < 0.25) schedule(buffer, late);
  });
}
