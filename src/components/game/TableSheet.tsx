import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';

/** Native modal keeps focus and keyboard interaction inside the active sheet. */
export function TableSheet({
  open,
  title,
  onClose,
  children,
  error,
  busy = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string | null;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return createPortal(
    <dialog
      ref={ref}
      className="table-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="table-sheet-header">
        <h2 id={titleId} className="font-serif text-lg text-gold">
          {title}
        </h2>
        <button
          type="button"
          className="table-tool"
          disabled={busy}
          onClick={onClose}
          aria-label={t('mission.close')}
        >
          ✕
        </button>
      </div>
      <div className="table-sheet-content">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-crimson/60 bg-crimson/20 p-3 text-sm text-parchment"
          >
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
