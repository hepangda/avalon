'use client';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils/cn';
import type { ClientGameState } from '@/lib/engine';

/**
 * The central "pick" pile: the players the leader has nominated (gold) or the
 * target the assassin has chosen (crimson), laid face-up in the middle of the
 * table — both are public actions. Tap a filled card to retract it; empty slots
 * show how many picks are still needed. Cards fly up from the hand and drop back
 * when retracted.
 */
export function PickPile({
  game,
  selected,
  size,
  tone,
  onRemove,
}: {
  game: ClientGameState;
  selected: string[];
  size: number;
  tone: 'gold' | 'crimson' | 'sky';
  /** Tap a card to retract it. Omit for a read-only display (e.g. the team
   *  being voted on). */
  onRemove?: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const players = selected
    .map((id) => game.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const emptySlots = Math.max(0, size - players.length);

  const filled =
    tone === 'crimson'
      ? 'border-crimson-bright bg-crimson/25 shadow-candle'
      : tone === 'sky'
        ? 'border-sky-300 bg-sky-500/20 shadow-candle'
        : 'border-gold bg-gold/20 shadow-candle';
  const pip =
    tone === 'crimson'
      ? 'bg-crimson-bright/30 text-parchment'
      : tone === 'sky'
        ? 'bg-sky-500/30 text-sky-100'
        : 'bg-gold/25 text-gold';

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {players.map((p) => (
          <motion.button
            key={p.id}
            layout
            type="button"
            disabled={!onRemove}
            onClick={onRemove ? () => onRemove(p.id) : undefined}
            initial={reduce ? false : { y: 64, opacity: 0, scale: 0.7 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 64, opacity: 0, scale: 0.6 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 24 }}
            className={cn(
              'flex h-16 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 px-1',
              filled,
              onRemove ? 'cursor-pointer' : 'cursor-default',
            )}
          >
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs', pip)}>
              {p.seat + 1}
            </span>
            <span className="max-w-full truncate text-[9px] leading-tight text-parchment">
              {p.name}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>

      {Array.from({ length: emptySlots }).map((_, i) => (
        <span
          key={`empty-${i}`}
          className="h-16 w-12 shrink-0 rounded-lg border border-dashed border-gold/25 bg-ink/20"
        />
      ))}
    </div>
  );
}
