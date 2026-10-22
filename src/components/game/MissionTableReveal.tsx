import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import {
  anonymousMissionCards,
  missionRevealTimeline,
  type TablePresentation,
} from '@/lib/game/tablePresentation';
import { GameIcon } from './GameArt';
import { SealFlight } from './SealFlight';
import { TableCard } from './TableCard';
import { useSoundCue } from '@/lib/audio/useSoundCue';

type Stage = 'gather' | 'shuffle' | 'reveal' | 'verdict' | 'seal';
const ORDER: Stage[] = ['gather', 'shuffle', 'reveal', 'verdict', 'seal'];

/** The cracks a failed card takes when it lands face up. */
function Cracks() {
  return (
    <svg className="mission-fail-cracks" viewBox="0 0 74 100" aria-hidden="true">
      {[
        'M37 46 L30 39 L27 30 L20 26 L16 16',
        'M37 46 L45 50 L52 48 L58 56 L66 58',
        'M37 46 L39 37 L36 29',
        'M37 46 L33 57 L35 66 L30 74',
        'M27 30 L22 33',
        'M52 48 L55 41',
      ].map((d) => <path key={d} d={d} pathLength={1} />)}
    </svg>
  );
}

export function MissionTableReveal({
  event,
  tableRef,
  onComplete,
}: {
  event: Extract<TablePresentation, { kind: 'mission' }>;
  tableRef: RefObject<HTMLDivElement | null>;
  onComplete: (id: string) => void;
}) {
  const t = useTranslations();
  const reduce = !!useReducedMotion();
  const [cards] = useState(() =>
    anonymousMissionCards(event.result.teamSize, event.result.failCount),
  );
  const [timeline] = useState(() => missionRevealTimeline(cards, event.requiredFails, reduce));
  const [stage, setStage] = useState<Stage>(reduce ? 'verdict' : 'gather');
  const [flipped, setFlipped] = useState(reduce ? event.result.teamSize : 0);
  const [paths, setPaths] = useState<
    Array<{ x: number; y: number; dx: number; dy: number }>
  >([]);
  const seal = useRef<HTMLDivElement>(null);
  const [sealFrom, setSealFrom] = useState<DOMRect | null>(null);
  const [sealTarget] = useState(() => () =>
    document.querySelector(`[data-mission-round="${event.result.roundIndex}"] .table-mission-token`));
  const at = ORDER.indexOf(stage);
  const success = event.result.success;
  // Sound: the cards slide in and riffle, each turns with its own flip, and the verdict lands with its sting.
  useSoundCue(stage === 'gather' || stage === 'shuffle' ? stage : null);
  useSoundCue(flipped > 0 && !reduce && 'flip', { key: flipped });
  useSoundCue(at >= ORDER.indexOf('verdict') && (success ? 'missionSuccess' : 'missionFail'));
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const rect = table.getBoundingClientRect();
    const slots = [...table.querySelectorAll<HTMLElement>('[data-seat-card]')];
    setPaths(
      event.team.flatMap((id) => {
        const slot = slots.find((el) => el.dataset.seatCard === id);
        if (!slot) return [];
        const box = slot.getBoundingClientRect();
        const x = box.left - rect.left + box.width / 2;
        const y = box.top - rect.top + box.height / 2;
        return [{ x, y, dx: rect.width / 2 - x, dy: rect.height / 2 - y }];
      }),
    );
  }, [event.team, tableRef]);
  useEffect(() => {
    const move = (next: Stage) => setStage((s) => (ORDER.indexOf(next) > ORDER.indexOf(s) ? next : s));
    const timers = reduce
      ? [setTimeout(() => onComplete(event.id), timeline.complete)]
      : [
          setTimeout(() => move('shuffle'), timeline.shuffle),
          setTimeout(() => move('reveal'), timeline.reveal),
          ...timeline.flips.map((ms, i) => setTimeout(() => {
            setFlipped(i + 1);
            // A failed card lands hard enough to shake the table.
            if (cards[i] === 'fail')
              tableRef.current?.animate(
                [0, -7, 6, -4, 3, -1, 0].map((x, k) => ({ transform: `translate(${x}px, ${k % 2 ? 2 : 0}px)` })),
                { duration: 420, delay: 230, easing: 'ease-out' },
              );
          }, ms)),
          setTimeout(() => move('verdict'), timeline.verdict),
          setTimeout(() => {
            const box = seal.current?.getBoundingClientRect();
            if (box?.width) setSealFrom(box);
            move('seal');
          }, timeline.seal),
          // In case the flight never lands (the board is gone), the table still moves on.
          setTimeout(() => onComplete(event.id), timeline.complete),
        ];
    return () => timers.forEach(clearTimeout);
  }, [event.id, onComplete, reduce, timeline, cards, tableRef]);
  const title =
    at >= ORDER.indexOf('verdict')
      ? t(success ? 'missionResult.succeeds' : 'missionResult.sabotaged')
      : t(stage === 'gather' ? 'table.collecting' : stage === 'shuffle' ? 'table.shuffling' : 'cue.missionCardsTitle');
  return (
    <div
      className="table-reveal-layer"
      role="status"
      aria-live="polite"
      data-stage={stage}
      style={{ '--team': event.result.teamSize } as CSSProperties}
    >
      {stage === 'gather' &&
        paths.map((p, i) => (
          <motion.div
            key={i}
            className="table-moving-card"
            style={{ left: p.x, top: p.y }}
            initial={{ x: 0, y: 0, rotate: 0 }}
            animate={{ x: p.dx, y: p.dy, rotate: (i - 1) * 6 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            <TableCard state="back" />
          </motion.div>
        ))}
      <div className="table-reveal-content">
        <motion.h2
          key={at >= ORDER.indexOf('verdict') ? 'verdict' : 'cue'}
          className={`table-phase-title${at >= ORDER.indexOf('verdict') ? ' mission-verdict' : ''}`}
          data-result={success ? 'success' : 'fail'}
          initial={reduce || at < ORDER.indexOf('verdict') ? false : { opacity: 0, scale: 1.5, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{
            type: 'spring', stiffness: 260, damping: 19,
            filter: { type: 'tween', duration: 0.4, ease: 'easeOut' },
          }}
        >
          {title}
        </motion.h2>
        <div
          className={`table-anonymous-cards ${stage === 'gather' || stage === 'shuffle' ? 'is-stacked' : 'is-spread'}`}
          aria-label={t('table.anonymousCards')}
        >
          {stage !== 'gather' &&
            cards.map((value, i) => (
              <motion.div
                key={i}
                className="table-anonymous-card mission-reveal-card"
                data-turned={i < flipped ? '' : undefined}
                data-hit={i < flipped && value === 'fail' && !reduce ? '' : undefined}
                // Cards mount when shuffling starts, so the entrance must animate.
                initial={{ x: 0, rotate: 0 }}
                animate={
                  stage === 'shuffle'
                    ? {
                        x: [
                          0,
                          (i % 2 ? -1 : 1) * 35,
                          0,
                          (i % 2 ? 1 : -1) * 35,
                          0,
                        ],
                        rotate: [0, (i - 1) * 12, 0, (1 - i) * 12, 0],
                      }
                    : { x: 0, rotate: 0, y: i === flipped && stage === 'reveal' ? -6 : 0 }
                }
                transition={{
                  duration: stage === 'shuffle' ? 1.1 : 0.3,
                  ease: 'easeInOut',
                }}
              >
                <TableCard state={i < flipped ? value : 'back'} />
                {value === 'fail' && i < flipped && !reduce && <Cracks />}
              </motion.div>
            ))}
          {at >= ORDER.indexOf('verdict') && (
            <motion.div
              ref={seal}
              className="mission-verdict-seal"
              data-result={success ? 'success' : 'fail'}
              style={{ visibility: sealFrom ? 'hidden' : undefined }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 2.4, rotate: success ? -8 : 12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 380, damping: 17, delay: 0.1 }}
            >
              <GameIcon name={success ? 'missionSuccess' : 'missionFail'} className="h-full w-full" />
            </motion.div>
          )}
        </div>
        <p className="table-phase-detail" style={{ visibility: at >= ORDER.indexOf('verdict') ? undefined : 'hidden' }}>
          {t('missionResult.failCards', { count: event.result.failCount })}
        </p>
      </div>
      {stage === 'seal' && sealFrom && (
        <SealFlight
          from={sealFrom}
          target={sealTarget}
          duration={0.8}
          className={success ? 'is-success' : 'is-fail'}
          onLand={() => onComplete(event.id)}
        >
          <GameIcon name={success ? 'missionSuccess' : 'missionFail'} className="h-full w-full" />
        </SealFlight>
      )}
    </div>
  );
}
