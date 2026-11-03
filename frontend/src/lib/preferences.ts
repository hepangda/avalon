import type { Locale } from '@/i18n/routing';

export const CARD_ART_STYLES = ['modern', 'classic', 'furry'] as const;
export type CardArtStyle = (typeof CARD_ART_STYLES)[number];
export const DEFAULT_CARD_ART_STYLE: CardArtStyle = 'modern';
export const DEFAULT_SOUND_PREFERENCES = {
  volume: 0.7, muted: false, voice: false, voiceVolume: 0.7, notify: false,
};

export interface DisplayPreferences {
  volume: number;
  muted: boolean;
  voice: boolean;
  voiceVolume: number;
  notify: boolean;
  locale: Locale;
  cardArt: CardArtStyle;
  /** Tablemates see only the title and score, not games, sides, roles or form. */
  hideRecord: boolean;
}

export function isCardArtStyle(value: unknown): value is CardArtStyle {
  return CARD_ART_STYLES.some((style) => style === value);
}
