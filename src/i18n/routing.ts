import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['zh', 'en'],
  defaultLocale: 'zh',
  // Always show the locale prefix so links are unambiguous (e.g. /zh, /en).
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];
