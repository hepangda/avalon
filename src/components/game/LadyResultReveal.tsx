import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { FlipCard } from '@/components/animations/FlipCard';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, Team } from '@/lib/engine';
import { GameIcon } from './GameArt';
import { TableSheet } from './TableSheet';

/** Only the inspecting player receives this private loyalty result. */
export function LadyResultReveal({ game, result, onClose }: {
  game: ClientGameState; result: { targetId: string; loyalty: Team }; onClose: () => void;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFlipped(true), reduceMotion ? 0 : 550);
    return () => clearTimeout(timer);
  }, [reduceMotion]);
  const evil = result.loyalty === 'evil';
  return (
    <TableSheet open title={t('lady.title')} onClose={onClose}>
      <div className="space-y-4 text-center">
        <p className="text-sm text-parchment/70">{t('lady.watersReveal', { name: labelById(game, result.targetId) })}</p>
        <FlipCard revealed={flipped} className="mx-auto h-32 w-24"
          back={<div className="flex h-full items-center justify-center rounded-xl border-2 border-sky-300/50 bg-gradient-to-br from-royal to-ink"><GameIcon name="lady" className="h-16 w-16" /></div>}
          front={<div className={`flex h-full flex-col items-center justify-center rounded-xl border-2 ${evil ? 'border-crimson bg-crimson/30' : 'border-sky-300 bg-sky-600/30'}`}>
            <GameIcon name={evil ? 'reject' : 'approve'} className="h-14 w-14" />
            <span className={`font-serif text-xl ${evil ? 'text-crimson-bright' : 'text-sky-200'}`}>{t(evil ? 'team.evil' : 'team.good')}</span>
          </div>} />
        <p className="text-xs text-parchment/40">{t('lady.onlyYouSeen')}</p>
        <button type="button" className="table-action w-full" onClick={onClose}>{t('mission.close')}</button>
      </div>
    </TableSheet>
  );
}
