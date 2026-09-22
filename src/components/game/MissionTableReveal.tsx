import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import {
  anonymousMissionCards,
  type TablePresentation,
} from '@/lib/game/tablePresentation';
import { TableCard } from './TableCard';

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
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<'gather' | 'shuffle' | 'reveal'>(
    reduce ? 'reveal' : 'gather',
  );
  const [cards] = useState(() =>
    anonymousMissionCards(event.result.teamSize, event.result.failCount),
  );
  const [paths, setPaths] = useState<
    Array<{ x: number; y: number; dx: number; dy: number }>
  >([]);
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
    if (reduce) setStage('reveal');
    const timers = reduce
      ? []
      : [
          setTimeout(() => setStage('shuffle'), 650),
          setTimeout(() => setStage('reveal'), 1850),
        ];
    timers.push(setTimeout(() => onComplete(event.id), reduce ? 1800 : 4200));
    return () => timers.forEach(clearTimeout);
  }, [event.id, onComplete, reduce]);
  return (
    <div className="table-reveal-layer" role="status" aria-live="polite">
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
        <h2 className="table-phase-title">
          {stage === 'reveal'
            ? t(
                event.result.success
                  ? 'missionResult.succeeds'
                  : 'missionResult.sabotaged',
              )
            : t(stage === 'gather' ? 'table.collecting' : 'table.shuffling')}
        </h2>
        <div
          className={`table-anonymous-cards ${stage !== 'reveal' ? 'is-stacked' : ''}`}
          aria-label={t('table.anonymousCards')}
        >
          {stage !== 'gather' &&
            cards.map((value, i) => (
              <motion.div
                key={i}
                className="table-anonymous-card"
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
                    : { x: 0, rotate: 0 }
                }
                transition={{
                  duration: stage === 'shuffle' ? 1.1 : 0,
                  ease: 'easeInOut',
                }}
              >
                <TableCard state={stage === 'reveal' ? value : 'back'} />
              </motion.div>
            ))}
        </div>
        {stage === 'reveal' && (
          <p className="table-phase-detail">
            {t('missionResult.failCards', { count: event.result.failCount })}
          </p>
        )}
      </div>
    </div>
  );
}
