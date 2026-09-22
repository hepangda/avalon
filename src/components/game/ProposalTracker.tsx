'use client';

import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { rejectionLimit, type ClientGameState } from '@/lib/engine';

/**
 * Proposal tracker sized to the configured rejection limit. Rejected proposals
 * fill red, the current proposal is gold, and the last is the deciding one.
 * `vertical` stacks the dots for the table's left rail.
 */
export function ProposalTracker({
  game,
  vertical = false,
  compact = false,
}: {
  game: ClientGameState;
  vertical?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations();
  const limit = rejectionLimit(game.config.maxRejections);
  const proposals = Array.from({ length: limit }, (_, i) => i);
  const rejected = game.rejectionCount;
  const current = rejected; // current proposal index (0-based)
  const danger = limit - rejected <= 2;

  if (compact) {
    const label = `${t('teamBuilder.proposalOf', { n: current + 1, total: limit })}${current === limit - 1 ? ` · ${t('proposal.hammerWarnLast')}` : ''}`;
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1"
        role="img"
        aria-label={label}
        title={label}
      >
        {proposals.map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full border text-xs',
              i < current
                ? 'border-crimson-bright/70 bg-crimson/40 text-red-200'
                : i === current
                  ? i === limit - 1
                    ? 'border-red-300 bg-crimson/60 text-red-100'
                    : 'border-gold bg-gold/25 text-gold'
                  : i === limit - 1
                    ? 'border-crimson-bright/50 text-crimson-bright'
                    : 'border-gold/25',
            )}
          >
            {i < current ? (
              '✕'
            ) : i === limit - 1 ? (
              '☠'
            ) : i === current ? (
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            ) : null}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center',
        vertical ? 'flex-col gap-1' : 'gap-2',
      )}
    >
      {!vertical && (
        <span className="text-xs text-parchment/50">{t('proposal.label')}</span>
      )}
      <div
        className={cn(
          'flex items-center',
          vertical ? 'flex-col gap-1' : 'gap-1',
        )}
      >
        {proposals.map((i) => {
          const isRejected = i < rejected;
          const isCurrent = i === current;
          const isHammer = i === limit - 1;
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
              title={isHammer ? t('proposal.hammer', { count: limit }) : `${i + 1}`}
            >
              {isRejected ? '✕' : isHammer ? '☠' : i + 1}
            </span>
          );
        })}
      </div>
      {!vertical && danger && (
        <span className="text-xs text-crimson-bright">
          {limit - rejected <= 1
            ? t('proposal.hammerWarnLast')
            : t('proposal.hammerWarn', { n: limit - rejected })}
        </span>
      )}
    </div>
  );
}
