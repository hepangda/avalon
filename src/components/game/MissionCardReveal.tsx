'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';

type Card = 'success' | 'fail';

const FIRST_DELAY = 0.35;
const STAGGER = 0.45;
const FLIP_DURATION = 0.55;

/**
 * Animated reveal of a mission's cards. Builds `failCount` fail cards + the rest
 * success, shuffles them CLIENT-SIDE (so every viewer sees a different order —
 * the cards stay anonymous; we never learn who played what), and flips them
 * over one by one.
 *
 * The shuffle runs once per mount via the useState initializer. `onComplete`
 * fires once the last card has finished flipping.
 */
export function MissionCardReveal({
  teamSize,
  failCount,
  revealed = false,
  instant = false,
  onComplete,
}: {
  teamSize: number;
  failCount: number;
  revealed?: boolean;
  /** Show the cards already face-up with no flip animation (history view). */
  instant?: boolean;
  onComplete?: () => void;
}) {
  const t = useTranslations();

  const [cards] = useState<Card[]>(() => {
    const arr: Card[] = [];
    for (let i = 0; i < teamSize; i++) arr.push(i < failCount ? 'fail' : 'success');
    // History view (instant): keep a fixed order so it never changes between
    // openings — successes first, then fails.
    if (instant) {
      return arr.sort((a, b) => (a === b ? 0 : a === 'success' ? -1 : 1));
    }
    // Live reveal: Fisher–Yates with Math.random — intentionally
    // non-deterministic per viewer so the cards stay anonymous.
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  });

  useEffect(() => {
    if (instant) {
      onComplete?.();
      return;
    }
    const totalMs = (FIRST_DELAY + (teamSize - 1) * STAGGER + FLIP_DURATION) * 1000;
    const id = setTimeout(() => onComplete?.(), totalMs);
    return () => clearTimeout(id);
    // Run once on mount; cards/teamSize are fixed per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <p className="text-center text-xs uppercase tracking-wide text-parchment/50">
        {instant || revealed ? t('cue.missionCardsTitle') : t('cue.revealingCards')}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {cards.map((card, i) => (
          <FlipMissionCard key={i} card={card} delay={FIRST_DELAY + i * STAGGER} instant={instant} />
        ))}
      </div>
    </div>
  );
}

function FlipMissionCard({
  card,
  delay,
  instant,
}: {
  card: Card;
  delay: number;
  instant?: boolean;
}) {
  const t = useTranslations();
  const isFail = card === 'fail';

  return (
    <div style={{ perspective: 800 }} className="h-20 w-14">
      <motion.div
        initial={{ rotateY: instant ? 180 : 0 }}
        animate={{ rotateY: 180 }}
        transition={instant ? { duration: 0 } : { delay, duration: FLIP_DURATION, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', position: 'relative', width: '100%', height: '100%' }}
      >
        {/* Back (face-down) */}
        <div
          style={{ backfaceVisibility: 'hidden', position: 'absolute', inset: 0 }}
          className="flex items-center justify-center rounded-lg border-2 border-gold/50 bg-gradient-to-b from-stone to-ink"
        >
          <span className="text-2xl opacity-60">⚜️</span>
        </div>
        {/* Front (revealed) */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            position: 'absolute',
            inset: 0,
          }}
          className={`flex flex-col items-center justify-center rounded-lg border-2 ${
            isFail ? 'border-crimson bg-crimson/30' : 'border-sky-300 bg-sky-600/30'
          }`}
        >
          <span className="text-2xl">{isFail ? '💀' : '✨'}</span>
          <span
            className={`text-[10px] font-bold ${isFail ? 'text-crimson-bright' : 'text-sky-200'}`}
          >
            {isFail ? t('cue.cardFail') : t('cue.cardSuccess')}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
