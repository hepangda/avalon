'use client';

import { useTranslations } from 'next-intl';
import type { ClientGameState } from '@/lib/engine';

/**
 * Five-dot proposal tracker for the current round. Each dot is one of the (up
 * to) five proposals before evil wins by hammer. Rejected proposals fill red,
 * the current proposal pulses gold, the 5th is marked as the deciding one.
 */
export function ProposalTracker({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const rejected = game.rejectionCount; // 0..4 already-rejected this round
  const current = rejected; // current proposal index (0-based)
  const danger = rejected >= 3;

  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-xs text-parchment/50">{t('proposal.label')}</span>
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4].map((i) => {
          const isRejected = i < rejected;
          const isCurrent = i === current;
          const isHammer = i === 4;
          return (
            <span
              key={i}
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
                isRejected
                  ? 'border-crimson bg-crimson/70 text-parchment'
                  : isCurrent
                    ? 'animate-pulse border-gold bg-gold/30 text-gold'
                    : isHammer
                      ? 'border-crimson/50 bg-ink/40 text-crimson/70'
                      : 'border-gold/30 bg-ink/30 text-parchment/40'
              }`}
              title={isHammer ? t('proposal.hammer') : `${i + 1}`}
            >
              {isRejected ? '✕' : isHammer ? '☠' : i + 1}
            </span>
          );
        })}
      </div>
      {danger && (
        <span className="text-xs text-crimson-bright">
          {4 - rejected <= 1
            ? t('proposal.hammerWarnLast')
            : t('proposal.hammerWarn', { n: 4 - rejected })}
        </span>
      )}
    </div>
  );
}
