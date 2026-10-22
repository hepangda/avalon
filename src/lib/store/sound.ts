import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Device-local: a muted laptop says nothing about the same account on a phone. */
interface SoundState {
  volume: number;
  muted: boolean;
  /** System notifications for a turn that arrives while the tab is hidden; opted into from settings. */
  notify: boolean;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setNotify: (notify: boolean) => void;
}

export const DEFAULT_VOLUME = 0.7;

export function clampVolume(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      volume: DEFAULT_VOLUME,
      muted: false,
      notify: false,
      setVolume: (volume) => set({ volume: clampVolume(volume) ?? DEFAULT_VOLUME }),
      setMuted: (muted) => set({ muted }),
      setNotify: (notify) => set({ notify }),
    }),
    {
      name: "avalon-sound",
      partialize: ({ volume, muted, notify }) => ({ volume, muted, notify }),
      merge: (stored, current) => {
        const saved = (stored ?? {}) as Partial<SoundState>;
        return {
          ...current,
          volume: clampVolume(saved.volume) ?? current.volume,
          muted: typeof saved.muted === "boolean" ? saved.muted : current.muted,
          notify: typeof saved.notify === "boolean" ? saved.notify : current.notify,
        };
      },
    },
  ),
);
