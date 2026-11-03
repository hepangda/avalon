import { useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import { playSound } from '@/lib/audio/engine';
import { useSoundStore } from '@/lib/store/sound';
import { buzz, clearIconBadge, closeNotification, flashTitle, notify, showIconBadge, stopTitleFlash } from './attention';
import { myTurn, turnAlertKey } from './turnAlert';

function calm() {
  stopTitleFlash();
  clearIconBadge();
  closeNotification();
}

/**
 * Tells the player when the table starts waiting on them: a chime while they are looking, and the
 * title, tab icon, an opted-in notification and a buzz while the tab is in the background.
 * `quiet` holds the alert back while a reveal is still playing.
 */
export function useTurnAlert(game: ClientGameState | null, myPlayerId: string | null, quiet: boolean) {
  const t = useTranslations();
  const key = game ? turnAlertKey(game, myPlayerId) : null;
  const kind = game && key ? myTurn(game, myPlayerId) : null;
  const alerted = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Held, not forgotten: the turn is announced once the reveal or reconnect is over, and only once.
    if (quiet) return;
    const first = alerted.current === undefined;
    if (!key) {
      if (!first) calm();
      alerted.current = null;
      return;
    }
    if (key === alerted.current) return;
    alerted.current = key;
    // Arriving on a turn already in progress needs no chime; the screen shows it.
    if (first && !document.hidden) return;
    if (!document.hidden) {
      // A redeal announces itself with the deal.
      if (kind !== 'role') playSound('turn');
      return;
    }
    const title = t('turnAlert.title');
    flashTitle(title);
    showIconBadge();
    buzz();
    if (useSoundStore.getState().notify && kind)
      notify(`${title} · ${t('common.appName')}`, t(`turnAlert.${kind}`), document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href);
  }, [key, kind, quiet, t]);

  useEffect(() => {
    const back = () => { if (!document.hidden) calm(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      calm();
    };
  }, []);
}
