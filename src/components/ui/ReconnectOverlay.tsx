import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';

/** The modal top layer covers sheets and makes the disconnected page inert. */
export function ReconnectOverlay({ active, sessionReplaced = false }: { active: boolean; sessionReplaced?: boolean }) {
  return active ? <ActiveReconnectOverlay key={String(sessionReplaced)} sessionReplaced={sessionReplaced} /> : null;
}

function ActiveReconnectOverlay({ sessionReplaced }: { sessionReplaced: boolean }) {
  const t = useTranslations();
  const [canRefresh, setCanRefresh] = useState(sessionReplaced);
  const message = t(sessionReplaced ? 'common.sessionReplaced' : 'common.reconnecting');
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
      aria-label={message}
      className="reconnect-overlay"
    >
      <div className="reconnect-content">
        {!sessionReplaced && <span className="reconnect-spinner" aria-hidden="true" />}
        <p role={sessionReplaced ? 'alert' : 'status'} aria-live={sessionReplaced ? 'assertive' : 'polite'}>{message}</p>
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
