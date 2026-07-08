'use client';

import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import type { ClientGameState } from '@/lib/engine';

/**
 * Five-dot proposal tracker for the current round. Each dot is one of the (up
 * to) five proposals before evil wins by hammer. Rejected proposals fill red,
 * the current proposal pulses gold, the 5th is marked as the deciding one.
 * `vertical` stacks the dots for the table's left rail.
 */
export function ProposalTracker({
  game,
  vertical = false,
}: {
  game: ClientGameState;
  vertical?: boolean;
}) {
  const t = useTranslations();
  const rejected = game.rejectionCount; // 0..4 already-rejected this round
  const current = rejected; // current proposal index (0-based)
  const danger = rejected >= 3;

  return (
    <div className={cn('flex items-center justify-center', vertical ? 'flex-col gap-1' : 'gap-2')}>
      {!vertical && <span className="text-xs text-parchment/50">{t('proposal.label')}</span>}
      <div className={cn('flex items-center', vertical ? 'flex-col gap-1' : 'gap-1')}>
        {[0, 1, 2, 3, 4].map((i) => {
          const isRejected = i < rejected;
          const isCurrent = i === current;
          const isHammer = i === 4;
          const dim = vertical ? 'h-4 w-4 text-[8px]' : 'h-5 w-5 text-[10px]';
          return (
            <span
              key={i}
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full border font-bold transition-colors',
                dim,
                isRejected
                  ? 'border-crimson bg-crimson/70 text-parchment'
                  : isCurrent
                    ? 'border-gold bg-gold/30 text-gold'
                    : isHammer
                      ? 'border-crimson/50 bg-ink/40 text-crimson/70'
                      : 'border-gold/30 bg-ink/30 text-parchment/40',
              )}
              title={isHammer ? t('proposal.hammer') : `${i + 1}`}
            >
              {isRejected ? '✕' : isHammer ? '☠' : i + 1}
            </span>
          );
        })}
      </div>
      {!vertical && danger && (
        <span className="text-xs text-crimson-bright">
          {4 - rejected <= 1
            ? t('proposal.hammerWarnLast')
            : t('proposal.hammerWarn', { n: 4 - rejected })}
        </span>
      )}
    </div>
  );
}
