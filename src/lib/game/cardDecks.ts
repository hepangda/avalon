import type { Role } from '@/lib/engine';
import type { CardArtStyle } from '@/lib/preferences';

interface CardDeck {
  label: 'cardArtModern' | 'cardArtClassic' | 'cardArtFurry';
  variants: Partial<Record<Role, readonly string[]>>;
}

/** Each deck owns its presentation and available art, independently of game rules. */
export const CARD_DECKS: Record<CardArtStyle, CardDeck> = {
  modern: {
    label: 'cardArtModern',
    variants: {
      LoyalServant: ['loyal-servant-1', 'loyal-servant-2', 'loyal-servant-3', 'loyal-servant-4'],
    },
  },
  classic: {
    label: 'cardArtClassic',
    variants: {
      LoyalServant: ['loyal-servant-1', 'loyal-servant-2', 'loyal-servant-3', 'loyal-servant-4', 'loyal-servant-5'],
      Minion: ['minion', 'minion-2'],
    },
  },
  furry: {
    label: 'cardArtFurry',
    variants: {
      LoyalServant: ['loyal-servant-1', 'loyal-servant-2', 'loyal-servant-3', 'loyal-servant-4'],
    },
  },
};
