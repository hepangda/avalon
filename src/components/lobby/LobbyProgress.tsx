import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { missionSizesFor, rejectionLimit, requiredFailsFor, speechDuration, type GameOptions } from '@/lib/engine';
import { cn } from '@/lib/utils/cn';

/** The match's progress strip as it will open: table size, speaking time, proposal track and mission pattern. */
export function LobbyProgress({ count, options }: { count: number; options: GameOptions }) {
  const t = useTranslations();
  const sizes = missionSizesFor(count);
  const fails = requiredFailsFor(count);
  const limit = rejectionLimit(options.maxRejections);
  const limitLabel = `${t('lobby.rejectionLimit')} ${limit}`;
  const speech = t('lobby.seconds', { seconds: speechDuration(options.speechSeconds) });

  return (
    <>
      <div className="table-status">
        <span className="table-status-label inline-flex min-w-0 items-center gap-2">
          <span>{t('lobby.tableSize', { count })}</span>
          <span className="lobby-progress-meta" title={t('lobby.speechDuration')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="10" cy="11" r="6.5" />
              <path d="M10 7.5V11l2.2 1.6M8 2.5h4" />
            </svg>
            <span className="sr-only">{t('lobby.speechDuration')} </span>
            <span className="tabular-nums">{speech}</span>
          </span>
          {options.ladyOfTheLake && <GameIcon name="lady" className="h-5 w-5" title={t('phase.LadyOfLake')} alt={t('phase.LadyOfLake')} />}
        </span>
        <span className="table-status-detail inline-flex items-center">
          <span className="inline-flex shrink-0 items-center gap-1" role="img" aria-label={limitLabel} title={limitLabel}>
            {Array.from({ length: limit }, (_, i) => {
              const last = i === limit - 1;
              return (
                <span
                  key={i}
                  aria-hidden="true"
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border text-xs',
                    i === 0
                      ? last ? 'border-red-300 bg-crimson/60 text-red-100' : 'border-gold bg-gold/25 text-gold'
                      : last ? 'border-crimson-bright/50 text-crimson-bright' : 'border-gold/25',
                  )}
                >
                  {last ? '☠' : i === 0 ? <span className="h-1.5 w-1.5 rounded-full bg-gold" /> : null}
                </span>
              );
            })}
          </span>
        </span>
      </div>
      <ol className="table-missions" aria-label={t('lobby.missionPattern')}>
        {sizes.map((size, i) => {
          const needsTwo = (fails[i] ?? 1) > 1;
          return (
            <li
              key={i}
              className="table-mission"
              aria-label={`${t('lobby.missionNumber', { n: i + 1 })} · ${size}${needsTwo ? ` · ${t('table.twoFails')}` : ''}`}
              title={needsTwo ? t('table.twoFails') : undefined}
            >
              <span aria-hidden="true">{size}</span>
              {needsTwo && (
                <span className="table-mission-protection" aria-hidden="true">
                  <svg viewBox="0 0 16 18" fill="none">
                    <path d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
