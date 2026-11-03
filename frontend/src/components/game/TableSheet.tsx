import { useCallback, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { closeSheet, openSheet, pressedOrigin } from './sheetMotion';

/** Keeps a conditionally rendered sheet mounted until its exit has landed. */
export function useSheetPresence(open: boolean) {
  const [lingering, setLingering] = useState(open);
  if (open && !lingering) setLingering(true);
  const onExited = useCallback(() => setLingering(false), []);
  return [open || lingering, onExited] as const;
}

/** Native modal keeps focus and keyboard interaction inside the active sheet. */
export function TableSheet({
  open,
  title,
  onClose,
  onExited,
  children,
  error,
  busy = false,
  className,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onExited?: () => void;
  children: ReactNode;
  error?: string | null;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const exited = useRef(onExited);
  exited.current = onExited;
  // While it flies back, the sheet keeps showing what it held when it was dismissed.
  const held = useRef({ title, children, error });
  if (open) held.current = { title, children, error };
  const shown = held.current;
  const titleId = useId();
  const t = useTranslations();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    let current = true;
    if (open) {
      const closing = dialog.hasAttribute('data-closing');
      dialog.removeAttribute('data-closing');
      if (!dialog.open) {
        origin.current = pressedOrigin();
        dialog.showModal();
        openSheet(dialog, origin.current);
      } else if (closing) {
        openSheet(dialog, origin.current, true);
      }
    } else if (dialog.open && !dialog.hasAttribute('data-closing')) {
      dialog.setAttribute('data-closing', '');
      void closeSheet(dialog, origin.current).then(() => {
        if (!current || !dialog.hasAttribute('data-closing')) return;
        dialog.removeAttribute('data-closing');
        dialog.close();
        dialog.getAnimations().forEach((animation) => animation.cancel());
        exited.current?.();
      });
    }
    return () => { current = false; };
  }, [open]);
  useLayoutEffect(() => () => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className={cn('table-sheet', className)}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy && open) onClose(); }}
      onClick={(e) => {
        if (!busy && open && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="table-sheet-header">
        <h2 id={titleId} className="font-serif text-lg text-gold">
          {shown.title}
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
        {shown.error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-crimson/60 bg-crimson/20 p-3 text-sm text-parchment"
          >
            {shown.error}
          </p>
        )}
        {shown.children}
      </div>
    </dialog>,
    document.body,
  );
}
