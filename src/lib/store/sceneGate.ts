import { create } from 'zustand';

/**
 * The gate drawn between the lobby and the match. It closes over the lobby, the
 * route changes behind it, and it opens once the table has its game.
 */
export type SceneGatePhase = 'idle' | 'closing' | 'closed' | 'opening';

export interface SceneGateOrigin { x: number; y: number; width: number }

interface SceneGateState {
  phase: SceneGatePhase;
  code: string | null;
  /** Where the lobby's engraved crest sat, so the seal can rise from it. */
  origin: SceneGateOrigin | null;
  arrived: boolean;
  navigate: (() => void) | null;
  /** Starts the transition; true when it is (already) running for this room. */
  close: (code: string, origin: SceneGateOrigin | null, navigate: () => void) => boolean;
  shut: () => void;
  /** The game page has something to show. */
  arrive: (code: string) => void;
  open: () => void;
  finish: () => void;
}

export const useSceneGate = create<SceneGateState>()((set, get) => ({
  phase: 'idle',
  code: null,
  origin: null,
  arrived: false,
  navigate: null,
  close: (code, origin, navigate) => {
    const { phase, code: current } = get();
    if (phase !== 'idle') return current === code;
    set({ phase: 'closing', code, origin, arrived: false, navigate });
    return true;
  },
  shut: () => {
    const { phase, navigate } = get();
    if (phase !== 'closing') return;
    set({ phase: 'closed', navigate: null });
    navigate?.();
  },
  arrive: (code) => {
    const { phase, code: current } = get();
    if ((phase === 'closing' || phase === 'closed') && current === code) set({ arrived: true });
  },
  open: () => {
    if (get().phase === 'closed') set({ phase: 'opening' });
  },
  finish: () => set({ phase: 'idle', code: null, origin: null, arrived: false, navigate: null }),
}));
