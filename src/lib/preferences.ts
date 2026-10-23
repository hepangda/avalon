import { isLocale, type Locale } from '@/i18n/routing';

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

/** Accept only supported fields and values; never accept an account from the client. */
export function parsePreferencePatch(value: unknown): Partial<DisplayPreferences> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length) return null;
  for (const [key, field] of entries) {
    if (key === 'locale' && typeof field === 'string' && isLocale(field)) continue;
    if (key === 'cardArt' && isCardArtStyle(field)) continue;
    if (['muted', 'voice', 'notify', 'hideRecord'].includes(key) && typeof field === 'boolean') continue;
    if (['volume', 'voiceVolume'].includes(key) && typeof field === 'number' && Number.isFinite(field) && field >= 0 && field <= 1) continue;
    return null;
  }
  return value as Partial<DisplayPreferences>;
}
