import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
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
  const resultByRound = new Map(
    game.missionResults.map((m) => [m.roundIndex, m]),
  );
  return (
      <div className="table-missions" aria-label={t('mission.track')}>
        {missionSizes.map((size, idx) => {
          const result = resultByRound.get(idx);
          const needsTwo = requiredFails[idx] === 2;
          const clickable = !!onSelect;
          return (
            <button
              type="button"
              key={idx}
              disabled={!clickable}
              className={cn(
                'table-mission',
                clickable && 'cursor-pointer hover:brightness-125',
                result
                  ? result.success
                    ? 'is-success'
                    : 'is-fail'
                  : idx === game.roundIndex &&
                      game.phase !== 'GameOver' &&
                      'is-current',
              )}
              onClick={() => onSelect?.(idx)}
              title={needsTwo ? t('table.twoFails') : undefined}
              aria-haspopup="dialog"
              aria-label={`${t('game.missionOf', { round: idx + 1 })} · ${size}${result ? ` · ${t(result.success ? 'missionResult.succeeds' : 'missionResult.sabotaged')}` : ''}${needsTwo ? ` · ${t('table.twoFails')}` : ''}`}
            >
              <span>{size}</span>
              {needsTwo && (
                <span className="table-mission-protection" aria-hidden="true">
                  <svg viewBox="0 0 16 18" fill="none">
                    <path
                      d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    );

}
