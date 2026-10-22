import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animate, useReducedMotion } from 'framer-motion';
import { GameIcon } from './GameArt';

const EASE_IN_OUT = [0.55, 0, 0.25, 1] as const;

/**
 * A token lifted off the felt and carried, on a short arc, onto its place on the
 * progress board. It rides above everything (the board sits outside the table)
 * and stays parked on the target until its owner unmounts it.
 */
export function SealFlight({ from, target, hold = 0, duration = 0.75, pop = false, onLand, className, children }: {
  from: DOMRect;
  /** Resolved when the flight starts, so a board that moved meanwhile is still hit. */
  target: () => Element | null;
  hold?: number;
  duration?: number;
  pop?: boolean;
  onLand?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const land = useRef(onLand);
  useLayoutEffect(() => { land.current = onLand; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const run = async () => {
      if (pop) await animate(el, { scale: [0, 1.35, 1], opacity: [0, 1, 1] }, { duration: 0.35, ease: 'easeOut' });
      await new Promise((resolve) => setTimeout(resolve, hold));
      const box = target()?.getBoundingClientRect();
      if (cancelled) return;
      if (!box || !box.width) {
        await animate(el, { opacity: 0, scale: 0.6 }, { duration: 0.3 });
      } else {
        const dx = box.left + box.width / 2 - (from.left + from.width / 2);
        const dy = box.top + box.height / 2 - (from.top + from.height / 2);
        const scale = box.width / from.width;
        // Up and over: lifted, carried, then pressed down onto the medallion.
        await animate(el, {
          x: [0, dx * 0.45, dx],
          y: [0, Math.min(dy * 0.45, 0) - 46, dy],
          scale: [1, 1.18, scale],
          rotate: [0, -10, 0],
        }, { duration, times: [0, 0.45, 1], ease: [EASE_IN_OUT, EASE_IN_OUT] });
      }
      if (!cancelled) land.current?.();
    };
    void run();
    return () => { cancelled = true; };
  }, [from, target, hold, duration, pop]);
  return createPortal(
    <div
      ref={ref}
      className={`seal-flight ${className ?? ''}`}
      aria-hidden="true"
      style={{ left: from.left, top: from.top, width: from.width, height: from.height, opacity: pop ? 0 : 1 }}
    >
      {children}
    </div>,
    document.body,
  );
}

const proposalSlot = (slot: number) => () => document.querySelector(`[data-proposal-slot="${slot}"]`);

/** A black stone struck beside "rejected", then dropped into its place on the proposal track. */
export function RejectionFlight({ slot }: { slot: number }) {
  const reduceMotion = useReducedMotion();
  const anchor = useRef<HTMLSpanElement>(null);
  const [from, setFrom] = useState<DOMRect | null>(null);
  const [target] = useState(() => proposalSlot(slot));
  useEffect(() => {
    if (reduceMotion) return;
    const timer = setTimeout(() => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const size = Math.max(26, Math.min(40, box.height * 1.3));
      setFrom(new DOMRect(box.left + 8, box.top + box.height / 2 - size / 2, size, size));
    }, 450);
    return () => clearTimeout(timer);
  }, [reduceMotion]);
  return (
    <span ref={anchor} className="rejection-anchor" aria-hidden="true">
      {from && (
        <SealFlight from={from} target={target} pop hold={450} duration={0.7} className="is-stone">
          <GameIcon name="reject" className="h-full w-full" />
        </SealFlight>
      )}
    </span>
  );
}
