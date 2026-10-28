import { useEffect, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { useLocaleStore } from '@/lib/store/locale';
import type { Locale } from './routing';
import zh from '../../messages/zh.json';
import en from '../../messages/en.json';

/** Locale is a persisted account/browser preference, independent of routing. */
const MESSAGES: Record<Locale, typeof zh & Partial<typeof import('../../messages/zh.debug.json')>> = { zh, en };
if (import.meta.env.DEV) {
  const [zhDebug, enDebug] = await Promise.all([
    import('../../messages/zh.debug.json'), import('../../messages/en.debug.json'),
  ]);
  Object.assign(MESSAGES.zh, zhDebug.default);
  Object.assign(MESSAGES.en, enDebug.default);
}

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
