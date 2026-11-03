import { DEFAULT_SOUND_PREFERENCES } from '@/lib/preferences';
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Local playback cache; signed-in preferences are restored and saved through the account store. */
interface SoundState {
  /** Table sound effects. */
  volume: number;
  muted: boolean;
  /** System notifications for a turn that arrives while the tab is hidden; opted into from settings. */
  notify: boolean;
  /** Narration is its own channel: switched and leveled apart from the effects. */
  voice: boolean;
  voiceVolume: number;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setNotify: (notify: boolean) => void;
  setVoice: (voice: boolean) => void;
  setVoiceVolume: (volume: number) => void;
}

export const DEFAULT_VOLUME = DEFAULT_SOUND_PREFERENCES.volume;

export function clampVolume(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      volume: DEFAULT_VOLUME,
      muted: false,
      notify: false,
      voice: DEFAULT_SOUND_PREFERENCES.voice,
      voiceVolume: DEFAULT_VOLUME,
      setVolume: (volume) => set({ volume: clampVolume(volume) ?? DEFAULT_VOLUME }),
      setMuted: (muted) => set({ muted }),
      setNotify: (notify) => set({ notify }),
      setVoice: (voice) => set({ voice }),
      setVoiceVolume: (volume) => set({ voiceVolume: clampVolume(volume) ?? DEFAULT_VOLUME }),
    }),
    {
      name: "avalon-sound",
      partialize: ({ volume, muted, notify, voice, voiceVolume }) => ({ volume, muted, notify, voice, voiceVolume }),
      merge: (stored, current) => {
        const saved = (stored ?? {}) as Partial<SoundState>;
        return {
          ...current,
          volume: clampVolume(saved.volume) ?? current.volume,
          muted: typeof saved.muted === "boolean" ? saved.muted : current.muted,
          voice: typeof saved.voice === "boolean" ? saved.voice : current.voice,
          voiceVolume: clampVolume(saved.voiceVolume) ?? current.voiceVolume,
          notify: typeof saved.notify === "boolean" ? saved.notify : current.notify,
        };
      },
    },
  ),
);
