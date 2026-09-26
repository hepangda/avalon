import { useTranslations } from 'use-intl';
import { speechDuration } from '@/lib/engine';

export function SpeechDurationSetting({ value, onChange, disabled = false }: {
  value?: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  return (
    <label className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/20 bg-ink/30 px-3 py-2 text-sm">
      <span>{t('lobby.speechDuration')}</span>
      <select
        className="rounded border border-gold/30 bg-ink px-3 py-2 text-parchment"
        value={speechDuration(value)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[...new Set([30, 60, 90, 120, 180, 240, 300, 600, speechDuration(value)])].sort((a, b) => a - b).map((seconds) => (
          <option key={seconds} value={seconds}>{t('lobby.seconds', { seconds })}</option>
        ))}
      </select>
    </label>
  );
}
