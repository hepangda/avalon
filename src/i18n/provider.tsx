'use client';

import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { useCurrentLocale } from './navigation';
import type { Locale } from './routing';
import zh from '../../messages/zh.json';
import en from '../../messages/en.json';

/**
 * Client i18n provider built on `use-intl` — the framework-agnostic core that
 * next-intl was built on, so the `useTranslations`/`useFormatter`/`useLocale`
 * hooks used throughout the components work unchanged. Messages are the same
 * `messages/*.json` files as before. Locale is read from the URL prefix.
 */

const MESSAGES: Record<Locale, typeof zh> = { zh, en: en as typeof zh };

const TIME_ZONE =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useCurrentLocale();
  return (
    <IntlProvider locale={locale} messages={MESSAGES[locale]} timeZone={TIME_ZONE}>
      {children}
    </IntlProvider>
  );
}
