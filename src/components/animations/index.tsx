'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

/** Fade + slight rise. Default entrance for cards and panels. */
export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Cross-fades between game phases, keyed by phase name. */
export function PhaseTransition({ phaseKey, children }: { phaseKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phaseKey}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * A 3D flip card. `revealed=false` shows the back (crest), `true` flips to the
 * front (role). Used on the identity reveal screen.
 */
export function FlipCard({
  revealed,
  front,
  back,
  className,
  onClick,
}: {
  revealed: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={className}
      style={{ perspective: 1200 }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <motion.div
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', position: 'relative', width: '100%', height: '100%' }}
      >
        <div
          style={{
            backfaceVisibility: 'hidden',
            position: 'absolute',
            inset: 0,
            height: '100%',
            width: '100%',
          }}
        >
          {back}
        </div>
        <div
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            position: 'absolute',
            inset: 0,
            height: '100%',
            width: '100%',
          }}
        >
          {front}
        </div>
      </motion.div>
    </div>
  );
}

/** Pulse used to draw the eye to the active actor (current leader, your turn). */
export function Pulse({ children, active }: { children: ReactNode; active: boolean }) {
  if (!active) return <>{children}</>;
  return (
    <motion.div
      animate={{ scale: [1, 1.04, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}
