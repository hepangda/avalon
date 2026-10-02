'use client';

import { useTranslations } from 'use-intl';
import { routing } from '@/i18n/routing';
import { useLocaleStore } from '@/lib/store/locale';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { cn } from '@/lib/utils/cn';

/** Changes language in place without navigating or remounting the room. */
export function LocaleSwitcher({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('locale');
  const locale = useLocaleStore((state) => state.locale);
  const save = useAccountPreferencesStore((state) => state.save);
  return (
    <div role="group" aria-label={t('switch')} className="flex items-center gap-1 rounded-full border border-gold/30 bg-ink/40 p-0.5">
      {routing.locales.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          lang={value}
          aria-pressed={value === locale}
          onClick={() => { if (value !== locale) void save({ locale: value }); }}
          className={cn(
            'min-h-10 rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-wait disabled:opacity-60',
            value === locale ? 'bg-gold text-ink' : 'text-parchment/60 hover:text-parchment',
          )}
        >
          {t(value)}
        </button>
      ))}
    </div>
  );
}
