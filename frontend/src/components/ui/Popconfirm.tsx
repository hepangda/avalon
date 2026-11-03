import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { useTranslations } from 'use-intl';

const EDGE = 12;
const GAP = 10;

export interface PopconfirmTrigger {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
  'aria-controls'?: string;
}

interface Placement { top: number; left: number; arrow: number; above: boolean }

/** A short question that grows out of the control it guards and folds back into it. */
export function Popconfirm({ title, confirmLabel, onConfirm, disabled = false, children }: {
  title: string;
  confirmLabel: string;
  onConfirm: () => unknown;
  disabled?: boolean;
  children: (trigger: PopconfirmTrigger) => ReactNode;
}) {
  const t = useTranslations();
  const still = useReducedMotion();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  // Under the trigger when there is room, otherwise over it; the arrow always points at it.
  // Followed every frame, so the bubble stays on a trigger that is still flying in with its sheet.
  useLayoutEffect(() => {
    if (!open) return;
    // The top layer keeps the bubble clear of a sheet's own flight transform; older browsers fall back to fixed.
    const node = bubbleRef.current;
    if (node && typeof node.showPopover === 'function' && !node.matches(':popover-open')) node.showPopover();
    let frame = 0;
    let last = '';
    function measure() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current;
      if (trigger && bubble) {
        const { offsetWidth: width, offsetHeight: height } = bubble;
        const center = trigger.left + trigger.width / 2;
        const left = Math.min(Math.max(EDGE, center - width / 2), window.innerWidth - EDGE - width);
        const above = trigger.bottom + GAP + height > window.innerHeight - EDGE && trigger.top - GAP - height >= EDGE;
        const next = {
          top: Math.round(above ? trigger.top - GAP - height : trigger.bottom + GAP),
          left: Math.round(left),
          arrow: Math.round(Math.min(Math.max(14, center - left), width - 14)),
          above,
        };
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setPlace(next);
        }
      }
      frame = requestAnimationFrame(measure);
    }
    measure();
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (bubbleRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    // Escape answers the question before it can dismiss the sheet underneath.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      close(false);
    } finally {
      setBusy(false);
    }
  }

  const tip = place ? `${place.arrow}px ${place.above ? '100%' : '0%'}` : '50% 0%';
  return (
    <>
      {children({
        ref: triggerRef,
        onClick: () => (open ? close() : !disabled && setOpen(true)),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': open ? id : undefined,
      })}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={bubbleRef}
            id={id}
            popover="manual"
            role="alertdialog"
            aria-labelledby={`${id}-title`}
            className="popconfirm"
            data-side={place?.above ? 'above' : 'below'}
            style={{ top: place?.top ?? -9999, left: place?.left ?? -9999, transformOrigin: tip, '--arrow': `${place?.arrow ?? 0}px` } as CSSProperties}
            initial={{ opacity: 0, scale: still ? 1 : 0.5 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: still ? 0.1 : 0.22, ease: [0.2, 0.8, 0.25, 1] } }}
            exit={{ opacity: 0, scale: still ? 1 : 0.5, transition: { duration: still ? 0.1 : 0.16, ease: [0.5, 0, 0.75, 0] } }}
          >
            <p id={`${id}-title`} className="popconfirm-title">{title}</p>
            <div className="popconfirm-actions">
              {/* Cancel takes focus so Enter never confirms by accident. */}
              <button type="button" className="popconfirm-cancel" autoFocus disabled={busy} onClick={() => close()}>
                {t('common.cancel')}
              </button>
              <button type="button" className="popconfirm-confirm" disabled={busy} aria-busy={busy}
                onClick={() => void confirm()}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
