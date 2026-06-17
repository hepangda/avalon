'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import type { ClientGameState } from '@/lib/engine';

export function MissionTrack({
  game,
  onSelect,
  vertical = false,
}: {
  game: ClientGameState;
  onSelect?: (roundIndex: number) => void;
  /** Stack the missions in a narrow column (for the table's left rail). */
  vertical?: boolean;
}) {
  const t = useTranslations();
  const { missionSizes, requiredFails } = game.config;
  const resultByRound = new Map(game.missionResults.map((m) => [m.roundIndex, m]));
  const hasHistory = (idx: number) =>
    game.voteHistory.some((v) => v.roundIndex === idx) || resultByRound.has(idx);

  return (
    <div className={vertical ? '' : 'space-y-1.5'}>
      <div
        className={cn(
          'flex items-center justify-center',
          vertical ? 'flex-col gap-1.5' : 'gap-2',
        )}
      >
        {missionSizes.map((size, idx) => {
          const result = resultByRound.get(idx);
          const isCurrent = idx === game.roundIndex && game.phase !== 'GameOver' && !result;
          const needsTwo = requiredFails[idx] === 2;
          const clickable = !!onSelect && hasHistory(idx);

          let bg = 'bg-stone/70 border-gold/30';
          if (result?.success) bg = 'bg-sky-600/80 border-sky-300';
          else if (result && !result.success) bg = 'bg-crimson/80 border-crimson';
          else if (isCurrent) bg = 'border-gold bg-gold/30';

          const dim = vertical ? 'h-9 w-9' : 'h-12 w-12';

          return (
            <motion.button
              key={idx}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect?.(idx)}
              animate={isCurrent ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={isCurrent ? { duration: 1.6, repeat: Infinity } : { duration: 0.2 }}
              className={cn(
                'relative flex shrink-0 flex-col items-center justify-center rounded-full border-2',
                dim,
                bg,
                clickable ? 'cursor-pointer ring-gold/40 hover:ring-2' : 'cursor-default',
              )}
              title={`${t('game.missionOf', { round: idx + 1 })} · ${size}${needsTwo ? ' · *' : ''}`}
            >
              {result ? (
                <span className={cn('font-bold text-white', vertical ? 'text-lg' : 'text-xl')}>
                  {result.success ? '✓' : '✕'}
                </span>
              ) : (
                <span className={cn('font-bold text-parchment', vertical ? 'text-sm' : 'text-sm')}>
                  {size}
                  {needsTwo && (
                    <sup className="ml-0.5 text-[8px] font-semibold text-amber-300/90">*</sup>
                  )}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      {onSelect && !vertical && (
        <p className="text-center text-[10px] text-parchment/40">{t('mission.tapForHistory')}</p>
      )}
    </div>
  );
}
