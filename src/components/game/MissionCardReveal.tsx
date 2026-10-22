import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';

/** Anonymous, static history cards: successes first, then failures. */
export function MissionCardReveal({ teamSize, failCount }: { teamSize: number; failCount: number }) {
  const t = useTranslations();
  return (
    <div className="mission-record" aria-label={t('cue.missionCardsTitle')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: teamSize }, (_, i) => {
          const fail = i >= teamSize - failCount;
          return (
            <div key={i} className="h-14 w-10 shrink-0">
              <div className={`flex h-full w-full flex-col items-center justify-center rounded-lg border-2 ${fail ? 'border-crimson bg-crimson/30' : 'border-sky-300 bg-sky-600/30'}`}>
                <GameIcon name={fail ? 'missionFail' : 'missionSuccess'} className="h-7 w-7" alt={t(fail ? 'cue.cardFail' : 'cue.cardSuccess')} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
