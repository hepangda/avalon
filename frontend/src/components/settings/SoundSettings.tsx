import { useState, type CSSProperties, type ReactNode } from 'react';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { useLocale, useTranslations } from 'use-intl';
import { playSound } from '@/lib/audio/engine';
import { previewVoice } from '@/lib/audio/useGameVoice';
import { useSoundStore } from '@/lib/store/sound';

const GLYPHS = {
  effects: <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fillOpacity="0.18" />,
  voice: <path d="M9 3.5h6v9a3 3 0 0 1-6 0zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="currentColor" fillOpacity="0.18" />,
};
const WAVES = {
  effects: <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />,
  voice: null,
};

function ChannelIcon({ kind, off }: { kind: keyof typeof GLYPHS; off: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[kind]}
      {off ? <path d={kind === 'effects' ? 'm16 9.5 5 5m0-5-5 5' : 'M4 4l16 16'} /> : WAVES[kind]}
    </svg>
  );
}

/** One audio channel: a seal that switches it, a groove that levels it, and the level itself. */
function Channel({ name, icon, on, volume, onToggle, onVolume, sample, disabled }: {
  name: string; icon: ReactNode; on: boolean; volume: number; disabled: boolean;
  onToggle: (on: boolean) => void; onVolume: (volume: number) => void; sample: () => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const percent = Math.round((draft ?? volume) * 100);
  function commit() {
    if (draft === null) return;
    onVolume(draft);
    setDraft(null);
    sample();
  }
  const silent = !on || volume === 0;
  return (
    <div className="fx-channel" data-silent={silent ? '' : undefined}>
      <button type="button" className="fx-channel-seal" disabled={disabled} aria-pressed={on} aria-label={name}
        onClick={() => { onToggle(!on); if (!on) sample(); }}>
        {icon}
      </button>
      <span aria-hidden="true" className="fx-channel-name">{name}</span>
      <input
        type="range"
        disabled={disabled}
        className="prefs-volume"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-label={name}
        aria-valuetext={`${percent}%`}
        style={{ '--fill': `${percent}%` } as CSSProperties}
        onChange={(event) => {
          setDraft(Number(event.target.value) / 100);
        }}
        // A sample at the new level once the thumb is let go, not on every step of the drag.
        onPointerUp={commit}
        onBlur={commit}
        onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') commit(); }}
      />
      <span aria-hidden="true" className="fx-channel-level">{percent}</span>
    </div>
  );
}

/** Account-backed effects and narration, each with its own switch and level. */
export function SoundSettings() {
  const t = useTranslations('preferences');
  const locale = useLocale();
  const { volume, muted, voice, voiceVolume } = useSoundStore();
  const { save, saving, error } = useAccountPreferencesStore();
  return (
    <section className="fx-audio" aria-label={t('sound')}>
      <h3 className="fx-audio-title">{t('sound')}</h3>
      <Channel name={t('effects')} icon={<ChannelIcon kind="effects" off={muted || volume === 0} />}
        on={!muted} volume={volume} disabled={saving}
        onToggle={(on) => void save({ muted: !on })} onVolume={(volume) => void save({ volume, muted: false })}
        sample={() => playSound('turn')} />
      <Channel name={t('voice')} icon={<ChannelIcon kind="voice" off={!voice || voiceVolume === 0} />}
        on={voice} volume={voiceVolume} disabled={saving}
        onToggle={(voice) => void save({ voice })} onVolume={(voiceVolume) => void save({ voiceVolume, voice: true })}
        sample={() => previewVoice(locale)} />
      {error && <p role="alert" className="fx-alert">{t('saveFailed')}</p>}
    </section>
  );
}
