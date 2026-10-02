import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isLocale, routing, type Locale } from '@/i18n/routing';

export function browserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return routing.defaultLocale;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: browserLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'avalon-locale',
      partialize: ({ locale }) => ({ locale }),
      merge: (stored, current) => {
        const locale = (stored as Partial<LocaleState> | null)?.locale;
        return { ...current, locale: isLocale(locale) ? locale : current.locale };
      },
    },
  ),
);
