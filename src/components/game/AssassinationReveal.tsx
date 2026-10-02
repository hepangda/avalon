import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { FlipCard } from '@/components/animations/FlipCard';
import { seatLabel } from '@/lib/game/playerLabel';
import type { TablePresentation } from '@/lib/game/tablePresentation';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';

/** Plays only after an authoritative assassination result arrives. */
export function AssassinationReveal({ event, onComplete }: {
  event: Extract<TablePresentation, { kind: 'assassination' }>;
  onComplete: (id: string) => void;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<'strike' | 'reveal' | 'result'>(reduceMotion ? 'result' : 'strike');
  const [closing, setClosing] = useState(false);
  const target = event.target;
  const revealed = stage !== 'strike';
  const resolved = stage === 'result';

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (closing || resolved) return;
    if (reduceMotion) {
      setStage('result');
      return;
    }
    const timer = setTimeout(
      () => setStage(stage === 'strike' ? 'reveal' : 'result'),
      stage === 'strike' ? 850 : 700,
    );
    return () => clearTimeout(timer);
  }, [stage, resolved, closing, reduceMotion]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="assassination-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); setClosing(true); }}
    >
      <motion.div
        className="assassination-scrim"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0.12 : 0.28 }}
        onAnimationComplete={() => {
          if (closing) {
            dialogRef.current?.close();
            onComplete(event.id);
          }
        }}
      />
      <motion.div
        className="assassination-scene"
        data-result={resolved ? (event.hitMerlin ? 'hit' : 'miss') : undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: 0.18 }}
      >
        <header className="assassination-heading">
          <p className="assassination-eyebrow">{t('assassin.targetLabel')}</p>
          <h2 id={titleId}>{seatLabel(target.seat, target.name)}</h2>
        </header>

        <div className="assassination-card-space">
          <div className="assassination-card-wrap">
            <motion.div
              className="assassination-aura"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: resolved ? 1 : 0 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.5 }}
            />
            <FlipCard
              revealed={revealed}
              className="assassination-card"
              front={<RoleCard role={target.role} variant={target.roleVariant} />}
              back={
                <div className="assassination-card-back">
                  <GameIcon name="crest" className="w-1/3" />
                </div>
              }
            />
            <AnimatePresence>
              {stage === 'strike' && !reduceMotion && (
                <motion.div
                  key="strike"
                  className="assassination-strike"
                  aria-hidden="true"
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <motion.svg
                    className="assassination-dagger"
                    viewBox="0 0 64 160"
                    initial={{ x: 65, y: -130, rotate: 28, opacity: 0 }}
                    animate={{ x: [65, 12, 0], y: [-130, -35, 14], rotate: [28, 12, -12], opacity: [0, 1, 1] }}
                    transition={{ duration: 0.68, times: [0, 0.6, 1], ease: 'easeIn' }}
                  >
                    <path d="M26 45 L24 113 L32 153 L40 113 L38 45 Z" fill="#dce6ef" stroke="#f5ecda" strokeWidth="1.5" />
                    <path d="M32 47 L32 148 L40 113 L38 45 Z" fill="#718196" />
                    <path d="M26 8 H38 L36 43 H28 Z" fill="#35272a" stroke="#c9a227" strokeWidth="2" />
                    <path d="M10 41 Q32 49 54 41 L51 51 Q32 56 13 51 Z" fill="#c9a227" />
                    <circle cx="32" cy="8" r="6" fill="#c9a227" />
                  </motion.svg>
                  <motion.div
                    className="assassination-impact"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: [0, 0.7, 0], scale: [0.4, 1, 1.3] }}
                    transition={{ duration: 0.45, delay: 0.55, ease: 'easeOut' }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="assassination-result" role="status" aria-live="polite" aria-atomic="true">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.2 }}
            >
              <h3>{t(resolved ? (event.hitMerlin ? 'assassin.hitTitle' : 'assassin.missTitle') : stage === 'strike' ? 'assassin.striking' : 'assassin.revealing')}</h3>
              {resolved && (
                <p className="outcome-title" data-winner={event.hitMerlin ? 'evil' : 'good'}>
                  {t(event.hitMerlin ? 'gameOver.evilPrevails' : 'gameOver.goodTriumphs')}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <button
          type="button"
          className="assassination-continue"
          onClick={() => resolved ? setClosing(true) : setStage('result')}
        >
          {t(resolved ? 'assassin.viewEnding' : 'assassin.skipAnimation')}
        </button>
      </motion.div>
    </dialog>,
    document.body,
  );
}
