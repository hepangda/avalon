/** Locale routing config. Framework-agnostic (was next-intl's defineRouting). */
export const routing = {
  locales: ['zh', 'en'] as const,
  defaultLocale: 'zh' as const,
  /** Always show the locale prefix so links are unambiguous (e.g. /zh, /en). */
  localePrefix: 'always' as const,
};

export type Locale = (typeof routing.locales)[number];

/** True if `seg` is a supported locale. */
export function isLocale(seg: string | undefined): seg is Locale {
  return !!seg && (routing.locales as readonly string[]).includes(seg);
}
