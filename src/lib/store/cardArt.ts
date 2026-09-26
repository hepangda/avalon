import { create } from 'zustand';
import type { CardArtStyle } from '@/lib/game/roleMeta';

interface CardArtState {
  style: CardArtStyle;
  setResource: (resource: unknown) => void;
}

// Only the current Flagship evaluation determines the art; never persist a decision.
export const useCardArtStore = create<CardArtState>((set) => ({
  style: 'classic',
  setResource: (resource) => set({ style: resource === 'furry' ? 'furry' : 'classic' }),
}));
