import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

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
  ariaLabel,
}: {
  revealed: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className={className}
      style={{ perspective: 1200 }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? ariaLabel : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <motion.div
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.6, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', position: 'relative', width: '100%', height: '100%' }}
      >
        <div
          aria-hidden={revealed}
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            position: 'absolute',
            inset: 0,
            height: '100%',
            width: '100%',
          }}
        >
          {back}
        </div>
        <div
          aria-hidden={!revealed}
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
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
