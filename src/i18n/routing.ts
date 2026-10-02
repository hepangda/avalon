/** Locale routing config. Framework-agnostic (was next-intl's defineRouting). */
export const routing = {
  locales: ['zh', 'en'] as const,
  defaultLocale: 'zh' as const,
};

export type Locale = (typeof routing.locales)[number];

/** True if `seg` is a supported locale. */
export function isLocale(seg: string | undefined): seg is Locale {
  return !!seg && (routing.locales as readonly string[]).includes(seg);
}

/** Only recognize complete legacy language segments. */
export function stripLocalePrefix(pathname: string): string {
  const parts = pathname.split('/');
  return isLocale(parts[1]) ? '/' + parts.slice(2).join('/') : pathname;
}
