import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CARD_ART_STYLE, isCardArtStyle, type CardArtStyle } from "@/lib/preferences";

interface CardArtState {
  style: CardArtStyle;
  setStyle: (style: CardArtStyle) => void;
}

export const useCardArtStore = create<CardArtState>()(
  persist(
    (set) => ({
      style: DEFAULT_CARD_ART_STYLE,
      setStyle: (style) => set({ style }),
    }),
    {
      name: "avalon-card-art",
      partialize: ({ style }) => ({ style }),
      merge: (stored, current) => {
        const style = (stored as Partial<CardArtState> | null)?.style;
        return { ...current, style: isCardArtStyle(style) ? style : current.style };
      },
    },
  ),
);
