'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import type { ClientGameState } from '@/lib/engine';

export function MissionTrack({
  game,
  onSelect,
}: {
  game: ClientGameState;
  onSelect?: (roundIndex: number) => void;
}) {
  const t = useTranslations();
  const { missionSizes, requiredFails } = game.config;
  const resultByRound = new Map(game.missionResults.map((m) => [m.roundIndex, m]));
  const hasHistory = (idx: number) =>
    game.voteHistory.some((v) => v.roundIndex === idx) || resultByRound.has(idx);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-center gap-2">
        {missionSizes.map((size, idx) => {
          const result = resultByRound.get(idx);
          const isCurrent = idx === game.roundIndex && game.phase !== 'GameOver' && !result;
          const needsTwo = requiredFails[idx] === 2;
          const clickable = !!onSelect && hasHistory(idx);

          let bg = 'bg-stone/70 border-gold/30';
          if (result?.success) bg = 'bg-sky-600/80 border-sky-300';
          else if (result && !result.success) bg = 'bg-crimson/80 border-crimson';
          else if (isCurrent) bg = 'border-gold bg-gold/30';

          return (
            <motion.button
              key={idx}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect?.(idx)}
              className={`relative flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 ${bg} ${
                clickable ? 'cursor-pointer ring-gold/40 hover:ring-2' : 'cursor-default'
              }`}
              title={`${t('game.missionOf', { round: idx + 1 })} · ${size}${
                needsTwo ? ' · 2✗' : ''
              }`}
            >
              {needsTwo && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs" title="2✗">
                  🛡
                </span>
              )}
              <span className="text-sm font-bold text-parchment">{size}</span>
              {needsTwo && <span className="text-[9px] font-semibold text-amber-300/80">2✗</span>}
              {result && (
                <span className="absolute -bottom-1 -right-1 text-xs">
                  {result.success ? '✅' : '❌'}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      {onSelect && (
        <p className="text-center text-[10px] text-parchment/40">{t('mission.tapForHistory')}</p>
      )}
    </div>
  );
}