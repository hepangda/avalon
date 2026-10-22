import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { rejectionLimit, type ClientGameState } from '@/lib/engine';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import {
  endingHasTitleCard,
  endingTimeline,
  type TablePresentation,
} from '@/lib/game/tablePresentation';
import { GameIcon } from './GameArt';
import { MissionToken } from './MissionTrack';

type Ending = Extract<TablePresentation, { kind: 'gameOver' }>;
/** title: the winner's card fills the screen; flip: seats turn over; settle: the felt takes the title back. */
export type EndingStage = 'title' | 'flip' | 'settle';

/** Waits while the tab is hidden, so nobody returns to an ending that already played to an empty room. */
function useWatching() {
  const [watching, setWatching] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    if (watching) return;
    const wake = () => { if (!document.hidden) setWatching(true); };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [watching]);
  return watching;
}

/** Drives the ending: how far it has got, and which identities have turned over. */
export function useEndingReveal(event: Ending | null, onComplete: (id: string) => void) {
  const reduceMotion = !!useReducedMotion();
  const watching = useWatching();
  const [state, setState] = useState<{ id: string; stage: EndingStage; flipped: number } | null>(null);
  const current = event && state?.id === event.id ? state : null;
  const titled = !!event && endingHasTitleCard(event.outcome);

  useLayoutEffect(() => {
    if (!event) return;
    setState({
      id: event.id,
      stage: titled ? 'title' : reduceMotion ? 'settle' : 'flip',
      flipped: reduceMotion ? event.order.length : 0,
    });
    // The event is fixed for its id; reduced motion is read once, when it starts.
  }, [event?.id]);

  const stage = current?.stage;
  useEffect(() => {
    if (!event || !stage || !watching) return;
    const timeline = endingTimeline(event, reduceMotion);
    const advance = (patch: Partial<NonNullable<typeof state>>) =>
      setState((s) => (s?.id === event.id ? { ...s, ...patch } : s));
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    if (stage === 'title') timers.push(setTimeout(() => advance(reduceMotion ? { stage: 'settle' } : { stage: 'flip' }), timeline.title));
    if (stage === 'flip') {
      timeline.flips.forEach((ms, i) => timers.push(setTimeout(() => advance({ flipped: i + 1 }), ms)));
      timers.push(setTimeout(() => advance({ stage: 'settle' }), timeline.settle));
    }
    if (stage === 'settle') timers.push(setTimeout(() => onComplete(event.id), timeline.done));
    return () => timers.forEach(clearTimeout);
  }, [event, stage, watching, titled, reduceMotion, onComplete]);

  const revealed = new Set(event && current ? event.order.slice(0, current.flipped) : []);
  return {
    stage: current?.stage ?? null,
    revealed,
    /** A tap on the title card moves straight on to the seats. */
    skipTitle: () => setState((s) => (s?.stage === 'title' ? { ...s, stage: reduceMotion ? 'settle' : 'flip' } : s)),
  };
}

const MOTES = Array.from({ length: 18 }, (_, i) => ({
  '--x': `${(i * 41 + 7) % 100}%`,
  '--dx': `${((i * 29) % 37) - 18}px`,
  '--delay': `${((i * 0.31) % 2).toFixed(2)}s`,
  '--dur': `${(2.6 + (i % 4) * 0.5).toFixed(2)}s`,
  '--size': `${2 + (i % 3)}px`,
}) as CSSProperties);

/** The winner's title card: as heavy as the assassination's verdict, for every other ending. */
export function GameOverTitleCard({ event, game, onSkip }: {
  event: Ending;
  game: ClientGameState;
  onSkip: () => void;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { winner, reason } = event.outcome;
  const byRejection = reason === 'five_rejections' || reason === 'rejection_limit';
  const enter = (delay: number) => ({ duration: reduceMotion ? 0.2 : 0.5, delay: reduceMotion ? 0 : delay });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="ending-dialog"
      aria-labelledby={titleId}
      data-winner={winner}
      onCancel={(e) => { e.preventDefault(); onSkip(); }}
    >
      <motion.div
        className="ending-scrim"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0.2 : 0.45 }}
      />
      <motion.div
        className="ending-scene"
        onClick={onSkip}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 24, filter: 'blur(4px)' }}
        transition={{ duration: reduceMotion ? 0.2 : 0.45, ease: 'easeInOut' }}
      >
        {!reduceMotion && <div className="ending-rays" aria-hidden="true" />}
        <motion.div
          className="ending-emblem"
          aria-hidden="true"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -90, scale: 1.5, rotate: -14 }}
          animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
          transition={reduceMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 210, damping: 15, delay: 0.15 }}
        >
          <div className="ending-emblem-pool" />
          <GameIcon
            name={byRejection ? 'reject' : winner === 'good' ? 'missionSuccess' : 'missionFail'}
            className="ending-emblem-art"
          />
        </motion.div>
        <h2 id={titleId} className="ending-title">
          <motion.span className="ending-rule" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={enter(0.55)} />
          <motion.span
            className="ending-title-text"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.7, filter: 'blur(12px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={reduceMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 240, damping: 18, delay: 0.45 }}
          >
            {t(winner === 'good' ? 'gameOver.goodTriumphs' : 'gameOver.evilPrevails')}
          </motion.span>
          <motion.span className="ending-rule" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={enter(0.55)} />
        </h2>
        <motion.p className="ending-reason" initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={enter(0.9)}>
          {t(`gameOver.${outcomeReasonKey(event.outcome)}`)}
        </motion.p>
        <ol className="ending-tally" aria-hidden="true">
          {byRejection
            ? Array.from({ length: rejectionLimit(game.config.maxRejections) }, (_, i) => (
              <motion.li key={i} className="ending-tally-stone" {...tallyIn(i, reduceMotion)}>
                <GameIcon name="reject" />
              </motion.li>
            ))
            : game.config.missionSizes.map((size, i) => {
              const result = game.missionResults.find((m) => m.roundIndex === i);
              return (
                <motion.li key={i} className="ending-tally-mission" {...tallyIn(i, reduceMotion)}>
                  <span className={result ? (result.success ? 'is-success' : 'is-fail') : undefined}>
                    <MissionToken size={size} needsTwo={false}
                      seal={result ? (result.success ? 'missionSuccess' : 'missionFail') : undefined} />
                  </span>
                </motion.li>
              );
            })}
        </ol>
        {!reduceMotion && (
          <div className="ending-motes" aria-hidden="true">
            {MOTES.map((style, i) => <i key={i} style={style} />)}
          </div>
        )}
      </motion.div>
    </dialog>,
    document.body,
  );
}

function tallyIn(i: number, reduceMotion: boolean | null) {
  return {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -18, scale: 1.6 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: reduceMotion
      ? { duration: 0.2 }
      : { type: 'spring' as const, stiffness: 420, damping: 20, delay: 1.1 + i * 0.12 },
  };
}
