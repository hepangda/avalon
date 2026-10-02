'use client';

import { useEffect, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { useLocaleStore } from '@/lib/store/locale';
import type { Locale } from './routing';
import zh from '../../messages/zh.json';
import en from '../../messages/en.json';

/**
 * Client i18n provider built on `use-intl` — the framework-agnostic core that
 * next-intl was built on, so the `useTranslations`/`useFormatter`/`useLocale`
 * hooks used throughout the components work unchanged. Messages are the same
 * `messages/*.json` files as before. Locale is a persisted browser preference, independent of routing.
 */

const MESSAGES: Record<Locale, typeof zh> = { zh, en: en as typeof zh };

const TIME_ZONE =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useLocaleStore((state) => state.locale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return (
    <IntlProvider locale={locale} messages={MESSAGES[locale]} timeZone={TIME_ZONE}>
      {children}
    </IntlProvider>
  );
}
