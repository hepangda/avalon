import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { rejectionLimit, type ClientGameState } from '@/lib/engine';

/**
 * Proposal tracker sized to the configured rejection limit. Rejected proposals
 * fill red, the current proposal is gold, and the last is the deciding one.
 */
export function ProposalTracker({
  game,
}: {
  game: ClientGameState;
}) {
  const t = useTranslations();
  const limit = rejectionLimit(game.config.maxRejections);
  const proposals = Array.from({ length: limit }, (_, i) => i);
  const rejected = game.rejectionCount;
  const current = rejected; // current proposal index (0-based)

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
