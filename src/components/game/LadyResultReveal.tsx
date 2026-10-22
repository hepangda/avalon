import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState, Team } from '@/lib/engine';
import { GameIcon } from './GameArt';
import { useSoundCue } from '@/lib/audio/useSoundCue';

/**
 * Only the inspecting player sees this. The lake stirs, the inspected player rises from
 * the water, and their side's crest surfaces in front of them.
 */
type Stage = 'still' | 'ripple' | 'rise' | 'crest';

const ORDER: Stage[] = ['still', 'ripple', 'rise', 'crest'];
const TIMELINE: Array<[Stage, number]> = [
  ['ripple', 350],
  ['rise', 950],
  ['crest', 2350],
];

/** Deterministic, so a re-render never moves the glints on the water. */
const GLINTS = Array.from({ length: 9 }, (_, i) => ({
  '--x': `${12 + ((i * 41) % 76)}%`,
  '--y': `${30 + ((i * 23) % 44)}%`,
  '--delay': `${((i * 0.37) % 2.4).toFixed(2)}s`,
}) as CSSProperties);

export function LadyResultReveal({ game, result, onClose }: {
  game: ClientGameState; result: { targetId: string; loyalty: Team }; onClose: () => void;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<Stage>(reduceMotion ? 'crest' : 'still');
  const [closing, setClosing] = useState(false);
  const [watching, setWatching] = useState(() => typeof document === 'undefined' || !document.hidden);
  const target = game.players.find((p) => p.id === result.targetId);
  const evil = result.loyalty === 'evil';
  const at = ORDER.indexOf(stage);
  const risen = at >= ORDER.indexOf('rise');
  const resolved = stage === 'crest';
  useSoundCue(resolved && 'lady');

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
      setStage('crest');
      return;
    }
    if (!watching) return;
    const timers = TIMELINE.map(([next, ms]) => setTimeout(
      () => setStage((current) => ORDER.indexOf(next) > ORDER.indexOf(current) ? next : current),
      ms,
    ));
    return () => timers.forEach(clearTimeout);
  }, [watching, reduceMotion]);

  const advance = () => resolved ? setClosing(true) : setStage('crest');
  const portrait = target && (
    <PlayerAvatar playerId={target.id} avatarUrl={target.claimed === false ? undefined : target.avatarUrl}
      name={target.name} className="lady-reveal-portrait" />
  );

  const scenery = (reflection: boolean) => (
    <>
      <motion.div
        className="lady-reveal-figure"
        initial={reduceMotion ? false : { y: '105%' }}
        animate={{ y: resolved ? '-52%' : risen ? '0%' : '105%' }}
        transition={resolved
          ? { duration: 0.8, ease: [0.3, 0, 0.2, 1] }
          : { duration: 1.3, ease: [0.16, 0.7, 0.25, 1] }}
      >
        {!reflection && <div className="lady-reveal-halo" aria-hidden="true" />}
        {portrait}
      </motion.div>
      <motion.div
        className="lady-reveal-crest"
        initial={reduceMotion ? false : { y: '110%', scale: 0.9 }}
        animate={resolved ? { y: '0%', scale: 1 } : { y: '110%', scale: 0.9 }}
        transition={reduceMotion ? { duration: 0 } : { delay: 0.12, type: 'spring', stiffness: 170, damping: 15, mass: 0.9 }}
      >
        {!reflection && <div className="lady-reveal-rays" aria-hidden="true" />}
        <GameIcon name={evil ? 'crest' : 'crestGood'} className="lady-reveal-crest-art" />
      </motion.div>
    </>
  );

  return createPortal(
    <dialog
      ref={dialogRef}
      className="lady-reveal-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); setClosing(true); }}
    >
      <motion.div
        className="lady-reveal-scrim"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0.12 : 0.45 }}
        onAnimationComplete={() => {
          if (closing) {
            dialogRef.current?.close();
            onClose();
          }
        }}
      />
      <motion.div
        className="lady-reveal-scene"
        data-stage={stage}
        data-team={resolved ? result.loyalty : undefined}
        data-still={reduceMotion || undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        onClick={advance}
      >
        <motion.header
          className="assassination-heading lady-reveal-heading"
          initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: reduceMotion ? 0 : 0.2 }}
        >
          <p className="assassination-eyebrow">
            <GameIcon name="lady" className="lady-reveal-eyebrow-icon" />
            {t('lady.title')}
          </p>
          <h2 id={titleId}>{target ? seatLabel(target.seat, target.name) : ''}</h2>
        </motion.header>

        <div className="lady-reveal-stage">
          <div className="lady-reveal-lake" aria-hidden="true">
            <div className="lady-reveal-water">
              {GLINTS.map((style, i) => <i key={i} style={style} />)}
            </div>
            {at >= ORDER.indexOf('ripple') && !reduceMotion && (
              <div className="lady-reveal-ripples">
                {[0, 1, 2, 3].map((i) => <i key={i} style={{ '--i': i } as CSSProperties} />)}
              </div>
            )}
            {resolved && !reduceMotion && (
              <div key="splash" className="lady-reveal-splash">
                {[0, 1].map((i) => <i key={i} style={{ '--i': i } as CSSProperties} />)}
              </div>
            )}
          </div>

          {/* Everything above the waterline rises; the reflection mirrors it below. */}
          <div className="lady-reveal-above">{scenery(false)}</div>
          <div className="lady-reveal-reflection" aria-hidden="true">{scenery(true)}</div>
        </div>

        <div className="lady-reveal-result" role="status" aria-live="polite" aria-atomic="true">
          {resolved && (
            <div className="assassination-verdict">
              <h3>
                <motion.span
                  className="assassination-verdict-rule"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, delay: reduceMotion ? 0 : 0.35, ease: 'easeOut' }}
                />
                <motion.span
                  className="assassination-verdict-title"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.5, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  transition={reduceMotion ? { duration: 0.1 } : { delay: 0.2, type: 'spring', stiffness: 240, damping: 18 }}
                >
                  {t(evil ? 'team.evil' : 'team.good')}
                </motion.span>
                <motion.span
                  className="assassination-verdict-rule"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, delay: reduceMotion ? 0 : 0.35, ease: 'easeOut' }}
                />
              </h3>
            </div>
          )}
        </div>
        <button
          type="button"
          className="assassination-continue"
          data-quiet={resolved ? undefined : ''}
          onClick={(e) => { e.stopPropagation(); advance(); }}
        >
          {t(resolved ? 'mission.close' : 'assassin.skipAnimation')}
        </button>
      </motion.div>
    </dialog>,
    document.body,
  );
}
