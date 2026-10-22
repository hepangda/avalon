import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { FlipCard } from '@/components/animations/FlipCard';
import { seatLabel } from '@/lib/game/playerLabel';
import type { TablePresentation } from '@/lib/game/tablePresentation';
import { GameIcon } from './GameArt';
import type { SoundName } from '@/lib/audio/engine';
import { useSoundCue } from '@/lib/audio/useSoundCue';
import { RoleCard } from './RoleCard';

/**
 * The lights drop, the dagger draws back over the face-down card, plunges in and is
 * pulled out; the card turns over and the table learns whether Merlin fell.
 */
type Stage = 'dark' | 'aim' | 'strike' | 'withdraw' | 'reveal' | 'result';

const ORDER: Stage[] = ['dark', 'aim', 'strike', 'withdraw', 'reveal', 'result'];
const TIMELINE: Array<[Stage, number]> = [
  ['aim', 500],
  ['strike', 1550],
  ['withdraw', 2600],
  ['reveal', 2950],
  ['result', 4000],
];
/** The heart races in the dark; the stab carries its own wind-up to the impact. */
const SOUNDS: Partial<Record<Stage, SoundName>> = { dark: 'heartbeat', strike: 'stab', reveal: 'flip' };
/** When the blade lands, measured from the start of the strike. */
const IMPACT = 0.15;
const FLIP = 0.95;

const OPEN = 'inset(0% 0% 0% 0%)';
/** Hides the blade below the point where it enters the card. */
const EMBED = 'inset(0% 0% 17% 0%)';

const dagger: Variants = {
  dark: { y: '-190%', rotate: -26, scale: 1.3, opacity: 0, filter: 'blur(8px)', clipPath: OPEN },
  aim: {
    y: ['-190%', '-84%', '-104%'],
    rotate: [-26, -11, -17],
    scale: [1.3, 1.08, 1.12],
    opacity: [0, 1, 1],
    filter: ['blur(8px)', 'blur(0px)', 'blur(0px)'],
    clipPath: OPEN,
    transition: { duration: 1, times: [0, 0.55, 1], ease: ['easeOut', 'easeInOut'] },
  },
  strike: {
    y: ['-104%', '0%', '0%', '0%', '0%'],
    rotate: [-17, -6, -2.5, -7.5, -6],
    scale: [1.12, 1, 1, 1, 1],
    opacity: 1,
    filter: 'blur(0px)',
    clipPath: [OPEN, EMBED, EMBED, EMBED, EMBED],
    transition: { duration: 0.62, times: [0, IMPACT / 0.62, 0.42, 0.62, 1], ease: [[0.8, 0, 1, 1], 'easeOut', 'easeInOut', 'easeOut'] },
  },
  withdraw: {
    y: '-58%',
    rotate: -12,
    opacity: 0,
    clipPath: OPEN,
    transition: { duration: 0.4, ease: [0.3, 0, 0.2, 1] },
  },
};

function cardPose(stage: Stage, hit: boolean) {
  switch (stage) {
    case 'dark':
      return { scale: 0.94, y: 0, opacity: 0, transition: { duration: 0.45 } };
    case 'aim':
      return { scale: [1, 1.018, 1, 1.024, 1], y: 0, opacity: 1, transition: { duration: 1, ease: 'easeInOut' } };
    case 'strike':
      return {
        scale: [1, 0.95, 1],
        y: [0, 7, 0],
        rotate: [0, -1.4, 0],
        opacity: 1,
        transition: { duration: 0.55, delay: IMPACT, ease: 'easeOut' },
      };
    case 'withdraw':
      return { scale: 1, y: 0, rotate: 0, opacity: 1 };
    case 'reveal':
      return { scale: [1, 1.07, 1.03], y: [0, -12, -4], opacity: 1, transition: { duration: FLIP + 0.1, ease: 'easeInOut' } };
    case 'result':
      return hit
        ? { scale: 1, y: 6, rotate: 0.8, opacity: 1, transition: { duration: 1.6, ease: 'easeOut' } }
        : { scale: 1.03, y: -4, rotate: 0, opacity: 1, transition: { duration: 0.6 } };
  }
}

function cardPoses(hit: boolean): Variants {
  return Object.fromEntries(ORDER.map((stage) => [stage, cardPose(stage, hit)]));
}

function Wound({ draw }: { draw: boolean }) {
  return (
    <svg className="assassination-wound" viewBox="0 0 200 300" aria-hidden="true">
      <g className="assassination-wound-cracks">
        {[
          'M100 120 L91 113 L86 102 L78 97 L72 85 L66 80',
          'M100 120 L109 125 L118 124 L127 132 L140 135',
          'M86 102 L79 105 L74 103',
          'M118 124 L121 116',
          'M100 120 L103 110 L101 101',
          'M100 120 L95 131 L96 141 L92 148',
          'M127 132 L129 141',
        ].map((d, i) => (
          <motion.path
            key={d}
            d={d}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={draw ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            transition={{ duration: 0.32, delay: draw ? IMPACT + i * 0.025 : 0, ease: 'easeOut' }}
          />
        ))}
      </g>
      <motion.path
        className="assassination-wound-slit"
        d="M88 122.5 Q100 116.5 112 117.5 Q100 120.5 88 122.5 Z"
        initial={{ scale: 0, opacity: 0 }}
        animate={draw ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        transition={{ duration: 0.12, delay: draw ? IMPACT : 0 }}
        style={{ transformOrigin: '100px 120px' }}
      />
    </svg>
  );
}

/** Deterministic scatter, so a re-render never reshuffles the drifting motes. */
const MOTES = Array.from({ length: 22 }, (_, i) => ({
  '--x': `${(i * 37 + 11) % 100}%`,
  '--dx': `${((i * 53) % 41) - 20}px`,
  '--delay': `${((i * 0.29) % 2.2).toFixed(2)}s`,
  '--dur': `${(2.8 + (i % 5) * 0.45).toFixed(2)}s`,
  '--size': `${2 + (i % 3)}px`,
}) as CSSProperties);

/** Plays only after an authoritative assassination result arrives. */
export function AssassinationReveal({ event, onComplete }: {
  event: Extract<TablePresentation, { kind: 'assassination' }>;
  onComplete: (id: string) => void;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<Stage>(reduceMotion ? 'result' : 'dark');
  const [closing, setClosing] = useState(false);
  // A background tab would otherwise sit through the whole scene unseen.
  const [watching, setWatching] = useState(() => typeof document === 'undefined' || !document.hidden);
  const target = event.target;
  const hit = event.hitMerlin;
  const at = ORDER.indexOf(stage);
  const struck = at >= ORDER.indexOf('strike');
  const revealed = at >= ORDER.indexOf('reveal');
  const resolved = stage === 'result';

  useSoundCue(watching && (resolved ? (hit ? 'assassinHit' : 'assassinMiss') : SOUNDS[stage]));

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (watching) return;
    const wake = () => { if (!document.hidden) setWatching(true); };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [watching]);

  useEffect(() => {
    if (reduceMotion) {
      setStage('result');
      return;
    }
    if (!watching) return;
    // Only ever moves forward, so skipping ahead is never undone by a later cue.
    const timers = TIMELINE.map(([next, ms]) => setTimeout(
      () => setStage((current) => ORDER.indexOf(next) > ORDER.indexOf(current) ? next : current),
      ms,
    ));
    return () => timers.forEach(clearTimeout);
  }, [watching, reduceMotion]);

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
        transition={{ duration: reduceMotion ? 0.12 : 0.45 }}
        onAnimationComplete={() => {
          if (closing) {
            dialogRef.current?.close();
            onComplete(event.id);
          }
        }}
      />
      <motion.div
        className="assassination-scene"
        data-stage={stage}
        data-result={resolved ? (hit ? 'hit' : 'miss') : undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: 0.3 }}
      >
        {struck && !reduceMotion && <div key="flash" className="assassination-flash" aria-hidden="true" />}

        <motion.header
          className="assassination-heading"
          initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: reduceMotion ? 0 : 0.2 }}
        >
          <p className="assassination-eyebrow">{t('assassin.targetLabel')}</p>
          <h2 id={titleId}>{seatLabel(target.seat, target.name)}</h2>
        </motion.header>

        <motion.div
          className="assassination-card-space"
          animate={stage === 'strike'
            ? { x: [0, -10, 9, -6, 4, -2, 0], y: [0, 6, -4, 3, -2, 1, 0] }
            : { x: 0, y: 0 }}
          transition={{ duration: 0.42, delay: stage === 'strike' ? IMPACT : 0 }}
        >
          <motion.div
            className="assassination-card-wrap"
            variants={cardPoses(hit)}
            initial={reduceMotion ? false : 'dark'}
            animate={stage}
          >
            <div className="assassination-pool" aria-hidden="true" />
            {resolved && !hit && <div className="assassination-rays" aria-hidden="true" />}
            <div className="assassination-aura" aria-hidden="true" />
            <FlipCard
              revealed={revealed}
              duration={FLIP}
              className="assassination-card"
              front={<RoleCard role={target.role} variant={target.roleVariant} />}
              back={
                <div className="assassination-card-back">
                  <GameIcon name="crest" className="w-1/3" />
                  <Wound draw={struck} />
                </div>
              }
            />
            {resolved && hit && (
              <div className="assassination-bleed" aria-hidden="true">
                <div className="assassination-blood" />
                <i style={{ '--left': '46.5%', '--len': '26%', '--delay': '0.5s' } as CSSProperties} />
                <i style={{ '--left': '52.5%', '--len': '14%', '--delay': '0.9s' } as CSSProperties} />
                <Wound draw />
              </div>
            )}
            {!reduceMotion && (
              <motion.div
                className="assassination-dagger"
                aria-hidden="true"
                variants={dagger}
                initial="dark"
                animate={stage in dagger ? stage : 'withdraw'}
              >
                <GameIcon name="assassinate" className="assassination-dagger-art" />
              </motion.div>
            )}
            {stage === 'strike' && (
              <div className="assassination-sparks" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} style={{ '--angle': `${i * 36 + (i % 2 ? 12 : -6)}deg`, '--reach': `${42 + (i * 17) % 38}px` } as CSSProperties} />
                ))}
              </div>
            )}
          </motion.div>
          {resolved && (
            <div className="assassination-motes" aria-hidden="true">
              {MOTES.map((style, i) => <i key={i} style={style} />)}
            </div>
          )}
        </motion.div>

        <div className="assassination-result" role="status" aria-live="polite" aria-atomic="true">
          <AnimatePresence mode="wait" initial={false}>
            {resolved ? (
              <motion.div key="verdict" className="assassination-verdict">
                <h3>
                  <motion.span
                    className="assassination-verdict-rule"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.7, delay: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
                  />
                  <motion.span
                    className="assassination-verdict-title"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.6, filter: 'blur(10px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    transition={reduceMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 260, damping: 18, mass: 0.9 }}
                  >
                    {t(hit ? 'assassin.hitTitle' : 'assassin.missTitle')}
                  </motion.span>
                  <motion.span
                    className="assassination-verdict-rule"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.7, delay: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
                  />
                </h3>
                <motion.p
                  className="outcome-title"
                  data-winner={hit ? 'evil' : 'good'}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: reduceMotion ? 0 : 0.55 }}
                >
                  {t(hit ? 'gameOver.evilPrevails' : 'gameOver.goodTriumphs')}
                </motion.p>
              </motion.div>
            ) : (
              <motion.p
                key={revealed || stage === 'withdraw' ? 'revealing' : 'striking'}
                className="assassination-cue"
                initial={{ opacity: 0, letterSpacing: '0.5em' }}
                animate={{ opacity: 1, letterSpacing: '0.32em' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                {t(revealed || stage === 'withdraw' ? 'assassin.revealing' : 'assassin.striking')}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <button
          type="button"
          className="assassination-continue"
          data-quiet={resolved ? undefined : ''}
          onClick={() => resolved ? setClosing(true) : setStage('result')}
        >
          {t(resolved ? 'assassin.viewEnding' : 'assassin.skipAnimation')}
        </button>
      </motion.div>
    </dialog>,
    document.body,
  );
}
