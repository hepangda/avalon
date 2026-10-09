import { useTranslations } from 'use-intl';
import { routing } from '@/i18n/routing';
import { useLocaleStore } from '@/lib/store/locale';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';

/** Changes language in place without navigating or remounting the room. */
export function LocaleSwitcher({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('locale');
  const locale = useLocaleStore((state) => state.locale);
  const save = useAccountPreferencesStore((state) => state.save);
  return (
    <div role="group" aria-label={t('switch')} className="prefs-locale">
      {routing.locales.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          lang={value}
          aria-pressed={value === locale}
          onClick={() => { if (value !== locale) void save({ locale: value }); }}
        >
          {t(value)}
        </button>
      ))}
    </div>
  );
}
