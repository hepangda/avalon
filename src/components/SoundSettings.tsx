import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import { playSound } from '@/lib/audio/engine';
import { notificationsSupported } from '@/lib/game/attention';
import { useSoundStore } from '@/lib/store/sound';

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fillOpacity="0.18" />
      {muted
        ? <path d="m16 9.5 5 5m0-5-5 5" />
        : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />}
    </svg>
  );
}

/** Volume and mute live on this device only; background alerts ask the browser for permission when switched on. */
export function SoundSettings() {
  const t = useTranslations('preferences');
  const { volume, muted, notify, setVolume, setMuted, setNotify } = useSoundStore();
  const [permission, setPermission] = useState(() => notificationsSupported() ? Notification.permission : 'denied');
  const silent = muted || volume === 0;
  const percent = Math.round(volume * 100);
  // Permission revoked in the browser since the switch was turned on reads as off.
  const notifying = notify && permission === 'granted';

  async function enableNotify() {
    if (!notificationsSupported()) return;
    const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPermission(result);
    setNotify(result === 'granted');
  }

  return (
    <>
      <div className="prefs-section">
        <span aria-hidden="true" className="prefs-label">{t('sound')}</span>
        <div className="prefs-sound" data-muted={silent ? '' : undefined}>
          <button
            type="button"
            className="prefs-mute"
            aria-pressed={muted}
            aria-label={t(muted ? 'unmute' : 'mute')}
            onClick={() => {
              setMuted(!muted);
              if (muted) playSound('turn');
            }}
          >
            <SpeakerIcon muted={silent} />
          </button>
          <input
            type="range"
            className="prefs-volume"
            min={0}
            max={100}
            step={5}
            value={percent}
            aria-label={t('volume')}
            aria-valuetext={`${percent}%`}
            style={{ '--fill': `${percent}%` } as CSSProperties}
            onChange={(event) => {
              setVolume(Number(event.target.value) / 100);
              if (muted) setMuted(false);
            }}
            // A sample at the new level once the thumb is let go, not on every step of the drag.
            onPointerUp={() => playSound('turn')}
            onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') playSound('turn'); }}
          />
        </div>
      </div>
      {notificationsSupported() && (
        <div className="prefs-section">
          <span aria-hidden="true" className="prefs-label">{t('notifications')}</span>
          <div role="group" aria-label={t('notifications')} className="prefs-locale"
            title={permission === 'denied' ? t('notificationsBlocked') : undefined}>
            <button type="button" aria-pressed={!notifying} onClick={() => setNotify(false)}>{t('off')}</button>
            <button type="button" aria-pressed={notifying} disabled={permission === 'denied'} onClick={() => void enableNotify()}>{t('on')}</button>
          </div>
        </div>
      )}
    </>
  );
}
