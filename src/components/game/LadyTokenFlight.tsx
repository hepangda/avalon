import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { TablePresentation } from '@/lib/game/tablePresentation';
import { GameIcon } from './GameArt';

type Point = { x: number; y: number };

/** In seconds: lift off, cross, sink into the inspected seat, rest there, settle as the new holder's mark. */
const TIMES = [0, 0.14, 0.5, 0.56, 0.84, 1];
const DURATION = 3;
/** The token's drawn size against the seat mark it starts and ends as (see .lady-flight-token). */
const TOKEN = 52;

/**
 * The token leaves the holder's seat, crosses the felt in an arc and sinks into the
 * inspected player, ripples spreading from their portrait, then stays with them as the new holder.
 */
export function LadyTokenFlight({ event, tableRef, onComplete }: {
  event: Extract<TablePresentation, { kind: 'lady' }>;
  tableRef: RefObject<HTMLDivElement | null>;
  onComplete: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const [path, setPath] = useState<{ from: Point; seat: Point; to: Point; mid: Point; mark: number; seatSize: number } | null>(null);
  const [landed, setLanded] = useState(false);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const rect = table.getBoundingClientRect();
    const center = (el: Element | null | undefined): Point | null => {
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { x: box.left - rect.left + box.width / 2, y: box.top - rect.top + box.height / 2 };
    };
    const fromIcon = table.querySelector(`[data-lady-icon="${event.holderId}"]`);
    const toIcon = table.querySelector(`[data-lady-icon="${event.targetId}"]`);
    const avatar = toIcon?.parentElement;
    const from = center(fromIcon);
    const to = center(toIcon);
    const seat = center(avatar);
    if (!from || !to || !seat || !avatar) return;
    // Arc over the felt rather than along the row of seats.
    const half = { x: (from.x + seat.x) / 2, y: (from.y + seat.y) / 2 };
    const mid = { x: half.x + (rect.width / 2 - half.x) * 0.3, y: half.y + (rect.height / 2 - half.y) * 0.45 - 30 };
    setPath({ from, seat, to, mid, mark: (fromIcon as HTMLElement).offsetWidth / TOKEN, seatSize: avatar.offsetWidth });
  }, [event.holderId, event.targetId, tableRef]);

  useEffect(() => {
    // Nobody is watching a background tab; the mark simply moves.
    const skip = reduce || document.hidden;
    const timers = [
      setTimeout(() => setLanded(true), skip ? 0 : TIMES[3]! * DURATION * 1000),
      setTimeout(() => onComplete(event.id), skip ? 700 : DURATION * 1000 + 120),
    ];
    return () => timers.forEach(clearTimeout);
  }, [event.id, onComplete, reduce]);

  if (!path) return null;
  const { from, seat, to, mid, mark } = path;
  const rel = (p: Point) => ({ x: p.x - from.x, y: p.y - from.y });
  const stops = [from, { x: from.x, y: from.y - 16 }, mid, seat, { x: seat.x, y: seat.y - 4 }, to].map(rel);
  return (
    <div className="lady-flight-layer" aria-hidden="true">
      {landed && (
        <div className="lady-flight-ripple" style={{ left: seat.x, top: seat.y }}>
          {[0, 1, 2].map((i) => <i key={i} style={{ '--i': i, '--d': `${path.seatSize}px` } as CSSProperties} />)}
        </div>
      )}
      {!reduce && (
        <motion.div
          className="lady-flight-token"
          style={{ left: from.x, top: from.y }}
          initial={{ x: 0, y: 0, scale: mark, rotate: 0 }}
          animate={{
            x: stops.map((p) => p.x),
            y: stops.map((p) => p.y),
            scale: [mark, 1.15, 1.3, 0.95, 1.05, mark],
            rotate: [0, -8, 6, 0, 0, 0],
          }}
          transition={{ duration: DURATION, times: TIMES, ease: ['easeOut', [0.45, 0, 0.3, 1], [0.5, 0, 0.9, 0.6], 'easeOut', [0.5, 0, 0.2, 1]] }}
        >
          <GameIcon name="lady" />
        </motion.div>
      )}
    </div>
  );
}
