import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';

/** The modal top layer covers sheets and makes the disconnected page inert. */
export function ReconnectOverlay({ active }: { active: boolean }) {
  return active ? <ActiveReconnectOverlay /> : null;
}

function ActiveReconnectOverlay() {
  const t = useTranslations();
  const [canRefresh, setCanRefresh] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const preventDismiss = (event: Event) => event.preventDefault();
    const keepOpen = () => { if (!element.open) element.showModal(); };
    element.addEventListener('cancel', preventDismiss);
    element.addEventListener('close', keepOpen);
    element.showModal();
    const refreshTimer = window.setTimeout(() => setCanRefresh(true), 10_000);
    return () => {
      window.clearTimeout(refreshTimer);
      element.removeEventListener('cancel', preventDismiss);
      element.removeEventListener('close', keepOpen);
      element.close();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog
      ref={dialog}
      aria-label={t('common.reconnecting')}
      className="reconnect-overlay"
    >
      <div className="reconnect-content">
        <span className="reconnect-spinner" aria-hidden="true" />
        <p role="status" aria-live="polite">{t('common.reconnecting')}</p>
        <div className="reconnect-refresh-slot">
          {canRefresh && (
            <button type="button" className="reconnect-refresh" onClick={() => window.location.reload()}>
              {t('common.forceRefresh')}
            </button>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
