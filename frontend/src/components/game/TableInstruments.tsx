import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { notificationsSupported } from '@/lib/game/attention';
import { useSoundStore } from '@/lib/store/sound';
import { ToolIcon } from './ToolIcons';

function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const supported = Boolean(
    document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function',
  );

  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setFailed(false);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggle() {
    if (!supported || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // Include body portals so dialogs and game tools remain visible.
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(Boolean(document.fullscreenElement));
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { isFullscreen, pending, failed, supported, toggle };
}

/** System notifications for a hidden tab; switching on asks the browser for permission. */
function useBackgroundAlerts() {
  const notify = useSoundStore((state) => state.notify);
  const { save, saving } = useAccountPreferencesStore();
  const [requesting, setRequesting] = useState(false);
  const supported = notificationsSupported();
  const [permission, setPermission] = useState(() => supported ? Notification.permission : 'denied');
  // Permission revoked in the browser since the switch was turned on reads as off.
  const on = notify && permission === 'granted';

  async function toggle() {
    if (saving || requesting) return;
    if (on) return save({ notify: false });
    if (!supported) return;
    setRequesting(true);
    try {
    const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPermission(result);
    await save({ notify: result === 'granted' });
    } finally { setRequesting(false); }
  }

  return { on, supported, busy: saving || requesting, blocked: permission === 'denied', toggle };
}

/** The viewer's own table settings: keys on one strip, lit while active. */
export function TableInstruments({ notesEnabled, onNotesChange, notesSaveFailed = false, onClearNotes, hasManualNotes = false }: {
  notesEnabled?: boolean;
  onNotesChange?: (value: boolean) => void;
  notesSaveFailed?: boolean;
  onClearNotes?: () => void;
  hasManualNotes?: boolean;
}) {
  const t = useTranslations();
  const fullscreen = useFullscreen();
  const alerts = useBackgroundAlerts();
  const alert = fullscreen.failed ? t('game.fullscreenFailed') : notesSaveFailed ? t('roleNotes.saveFailed') : null;
  return (
    <section className="fx-instruments">
      <div className="fx-keys">
        <button type="button" className="fx-key" aria-pressed={fullscreen.isFullscreen}
          disabled={!fullscreen.supported || fullscreen.pending} aria-busy={fullscreen.pending}
          title={fullscreen.supported ? undefined : t('game.fullscreenUnavailable')}
          onClick={() => void fullscreen.toggle()}>
          <ToolIcon art={{ glyph: fullscreen.isFullscreen ? 'exitFullscreen' : 'fullscreen' }} />
          <span>{t(fullscreen.isFullscreen ? 'game.exitFullscreen' : 'game.enterFullscreen')}</span>
        </button>
        {onNotesChange && (
          <button type="button" className="fx-key" aria-pressed={!!notesEnabled}
            aria-label={t('roleNotes.showKnown')} onClick={() => onNotesChange(!notesEnabled)}>
            <ToolIcon art={{ glyph: 'notes' }} />
            <span>{t('roleNotes.showKnownShort')}</span>
          </button>
        )}
        {onClearNotes && (
          <button type="button" className="fx-key" disabled={!hasManualNotes} onClick={onClearNotes}>
            <ToolIcon art={{ glyph: 'clearNotes' }} />
            <span>{t('roleNotes.clearAll')}</span>
          </button>
        )}
        {alerts.supported && (
          <button type="button" className="fx-key" aria-pressed={alerts.on} disabled={alerts.busy || (alerts.blocked && !alerts.on)}
            title={alerts.blocked ? t('preferences.notificationsBlocked') : undefined} onClick={() => void alerts.toggle()}>
            <ToolIcon art={{ glyph: 'alerts' }} />
            <span>{t('preferences.notifications')}</span>
          </button>
        )}
      </div>
      {alert && <p role="alert" className="fx-alert">{alert}</p>}
    </section>
  );
}
