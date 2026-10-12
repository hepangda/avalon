import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type CSSProperties } from 'react';
import { GameIcon } from '@/components/game/GameArt';
import { useSceneGate } from '@/lib/store/sceneGate';

const CLOSE_DELAY = 0.08;
const CLOSE_DURATION = 0.72;
/** The leaves meet, then the seal settles before the route changes behind them. */
const CLOSE_MS = (CLOSE_DELAY + CLOSE_DURATION) * 1000 + 220;
const HOLD_MS = 260;
const FALLBACK_MS = 6000;
const OPEN_DELAY = 0.3;
const OPEN_DURATION = 0.9;
const OPEN_MS = (OPEN_DELAY + OPEN_DURATION) * 1000 + 40;

function medalSize() {
  return Math.round(Math.max(88, Math.min(136, Math.min(window.innerWidth, window.innerHeight) * 0.24)));
}

/** One half of the seal; each gate leaf clips the shared medallion at its inner edge. */
function Medal() {
  return (
    <span className="scene-gate-medal">
      <span className="scene-gate-ring" />
      <span className="scene-gate-crest-wrap">
        <GameIcon name="crest" className="scene-gate-crest" />
      </span>
    </span>
  );
}

/** Lobby → match: gilded gates close over the room, its crest seals them, and they open on the table. */
export function SceneGate() {
  const phase = useSceneGate((s) => s.phase);
  const origin = useSceneGate((s) => s.origin);
  const arrived = useSceneGate((s) => s.arrived);
  const reduce = !!useReducedMotion();
  const [visible, setVisible] = useState(() => !document.hidden);
  const [size, setSize] = useState(medalSize);

  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    const resize = () => setSize(medalSize());
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    const gate = useSceneGate.getState();
    let id: ReturnType<typeof setTimeout> | undefined;
    if (phase === 'closing') id = setTimeout(gate.shut, reduce ? 260 : CLOSE_MS);
    // A hidden tab keeps the gate shut so the opening is seen; a lost game page still opens.
    else if (phase === 'closed') id = setTimeout(gate.open, arrived && visible ? HOLD_MS : FALLBACK_MS);
    else if (phase === 'opening') id = setTimeout(gate.finish, reduce ? 260 : OPEN_MS);
    return () => clearTimeout(id);
  }, [phase, arrived, visible, reduce]);

  if (phase === 'idle') return null;
  const opening = phase === 'opening';
  const leaf = (side: -1 | 1) => reduce
    ? { initial: { opacity: 0 }, animate: { opacity: opening ? 0 : 1 }, transition: { duration: 0.24 } }
    : {
        initial: { x: `${side * 101}%` },
        animate: { x: opening ? `${side * 104}%` : '0%' },
        transition: opening
          ? { delay: OPEN_DELAY, duration: OPEN_DURATION, ease: [0.65, 0, 0.25, 1] }
          : { delay: CLOSE_DELAY, duration: CLOSE_DURATION, ease: [0.7, 0, 0.35, 1] },
      };
  const fly = origin && !reduce
    ? {
        x: origin.x - window.innerWidth / 2,
        y: origin.y - window.innerHeight / 2,
        // The engraved crest fills the medallion's crest (60% of it).
        scale: origin.width / (size * 0.6),
      }
    : { x: 0, y: 0, scale: 0.6 };

  return (
    <div className="scene-gate" data-phase={phase} style={{ '--medal': `${size}px` } as CSSProperties} aria-hidden="true">
      <motion.div
        className="scene-gate-shade"
        initial={{ opacity: 0 }}
        animate={{ opacity: opening ? 0 : 1 }}
        transition={{ duration: opening ? 0.5 : 0.6, delay: opening ? OPEN_DELAY : 0 }}
      />
      <motion.div
        className="scene-gate-doors"
        initial={{ y: 0 }}
        // The leaves land with a short, heavy settle.
        animate={{ y: phase === 'closing' && !reduce ? [0, 0, 3, -1, 0] : 0 }}
        transition={{ duration: CLOSE_DELAY + CLOSE_DURATION + 0.18, times: [0, 0.79, 0.86, 0.94, 1] }}
      >
        <motion.div className="scene-gate-leaf" data-side="left" {...leaf(-1)}>
          <Medal />
        </motion.div>
        <motion.div className="scene-gate-leaf" data-side="right" {...leaf(1)}>
          <Medal />
        </motion.div>
        {!reduce && (
          <motion.span
            className="scene-gate-seam"
            initial={{ opacity: 0, scaleX: 1 }}
            animate={opening
              ? { opacity: [0.7, 1, 0], scaleX: [1, 3, 60] }
              : { opacity: [0, 0, 1, 0.55] }}
            transition={opening
              ? { duration: OPEN_DELAY + 0.55, times: [0, 0.35, 1], ease: 'easeOut' }
              : { duration: CLOSE_DELAY + CLOSE_DURATION + 0.4, times: [0, 0.74, 0.82, 1] }}
          />
        )}
      </motion.div>
      {!opening && (
        <motion.span
          className="scene-gate-fly"
          initial={fly}
          animate={{ x: 0, y: 0, scale: 1 }}
          transition={{ duration: reduce ? 0 : 0.74, ease: [0.3, 0, 0.2, 1] }}
        >
          <span className="scene-gate-medal">
            <motion.span
              className="scene-gate-ring"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduce ? 0 : 0.48, duration: 0.3 }}
            />
            <motion.span
              className="scene-gate-crest-wrap"
              initial={{ opacity: origin ? 0.06 : 0, filter: 'grayscale(1)' }}
              animate={{ opacity: 1, filter: 'grayscale(0)' }}
              transition={{ duration: reduce ? 0 : 0.6 }}
            >
              <GameIcon name="crest" className="scene-gate-crest" />
            </motion.span>
          </span>
        </motion.span>
      )}
    </div>
  );
}
