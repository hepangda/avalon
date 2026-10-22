import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import type { ClientGameState } from '@/lib/engine';
import { GameIcon } from './GameArt';
import { useArrival } from '@/lib/game/useArrival';

/** The quest board's five medallions: team size until played, then the outcome's seal. */
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
  const stamped = useArrival(game.missionResults.length, `${game.gameId}-${game.phaseRevision ?? 0}`);
  return (
    <ol className="table-missions" aria-label={t('mission.track')}>
      {missionSizes.map((size, idx) => {
        const result = resultByRound.get(idx);
        const needsTwo = requiredFails[idx] === 2;
        const current = !result && idx === game.roundIndex && game.phase !== 'GameOver';
        return (
          <li key={idx}>
            <button
              type="button"
              data-mission-round={idx}
              data-stamped={result && stamped === idx ? '' : undefined}
              disabled={!onSelect}
              className={cn(
                'table-mission',
                result ? (result.success ? 'is-success' : 'is-fail') : current && 'is-current',
              )}
              onClick={() => onSelect?.(idx)}
              title={needsTwo ? t('table.twoFails') : undefined}
              aria-haspopup="dialog"
              aria-current={current ? 'step' : undefined}
              aria-label={`${t('game.missionOf', { round: idx + 1 })} · ${size}${result ? ` · ${t(result.success ? 'missionResult.succeeds' : 'missionResult.sabotaged')}` : ''}${needsTwo ? ` · ${t('table.twoFails')}` : ''}`}
            >
              <MissionToken size={size} needsTwo={needsTwo}
                seal={result ? (result.success ? 'missionSuccess' : 'missionFail') : undefined}
                fails={result && !result.success ? result.failCount : undefined} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** One medallion; the lobby shows the same board before the deal. */
export function MissionToken({ size, needsTwo, seal, fails }: {
  size: number; needsTwo: boolean; seal?: 'missionSuccess' | 'missionFail'; fails?: number;
}) {
  return (
    <span className="table-mission-token" aria-hidden="true">
      {seal ? <GameIcon name={seal} className="table-mission-seal" /> : <span className="table-mission-size">{size}</span>}
      {fails !== undefined && fails > 0 && <span className="table-mission-fails">{fails}</span>}
      {needsTwo && !seal && (
        <span className="table-mission-protection">
          <svg viewBox="0 0 16 18" fill="none">
            <path d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z" fill="currentColor" stroke="#16100a" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </span>
  );
}
