import { isLocale, type Locale } from '@/i18n/routing';

export const CARD_ART_STYLES = ['modern', 'classic', 'furry'] as const;
export type CardArtStyle = (typeof CARD_ART_STYLES)[number];
export const DEFAULT_CARD_ART_STYLE: CardArtStyle = 'modern';
export interface DisplayPreferences {
  locale: Locale;
  cardArt: CardArtStyle;
}

export function isCardArtStyle(value: unknown): value is CardArtStyle {
  return CARD_ART_STYLES.some((style) => style === value);
}

/** Accept only supported fields and values; never accept an account from the client. */
export function parsePreferencePatch(value: unknown): Partial<DisplayPreferences> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length) return null;
  for (const [key, field] of entries) {
    if (key === 'locale' && typeof field === 'string' && isLocale(field)) continue;
    if (key === 'cardArt' && isCardArtStyle(field)) continue;
    return null;
  }
  return value as Partial<DisplayPreferences>;
}
