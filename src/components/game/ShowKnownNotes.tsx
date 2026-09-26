import { useTranslations } from 'use-intl';

export function ShowKnownNotes({
  checked,
  onChange,
  saveFailed = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  saveFailed?: boolean;
}) {
  const t = useTranslations('roleNotes');
  return (
    <div className="pointer-events-auto w-full rounded-lg border border-gold/20 bg-ink/70 px-3 py-2 text-left">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-parchment">
        <input
          type="checkbox"
          className="h-4 w-4 accent-gold"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {t('showKnown')}
      </label>
      {saveFailed && (
        <p role="alert" className="mt-1 text-xs text-amber-300">
          {t('saveFailed')}
        </p>
      )}
    </div>
  );
}
