import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';

/** Anonymous, static history cards: successes first, then failures. */
export function MissionCardReveal({ teamSize, failCount }: { teamSize: number; failCount: number }) {
  const t = useTranslations();
  return (
    <div className="space-y-2">
      <p className="text-center text-xs uppercase tracking-wide text-parchment/50">{t('cue.missionCardsTitle')}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {Array.from({ length: teamSize }, (_, i) => {
          const fail = i >= teamSize - failCount;
          return (
            <div key={i} className="h-20 w-14 shrink-0">
              <div className={`flex h-full w-full flex-col items-center justify-center rounded-lg border-2 ${fail ? 'border-crimson bg-crimson/30' : 'border-sky-300 bg-sky-600/30'}`}>
                <GameIcon name={fail ? 'missionFail' : 'missionSuccess'} className="h-9 w-9" />
                <span className={`text-[10px] font-bold ${fail ? 'text-crimson-bright' : 'text-sky-200'}`}>{t(fail ? 'cue.cardFail' : 'cue.cardSuccess')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
