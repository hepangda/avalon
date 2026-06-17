'use client';

import { useTranslations } from 'next-intl';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

/**
 * Lady of the Lake prompt for the centre board. The holder plays a target card
 * from their hand (HandArea); the chosen target shows in the central PickPile,
 * and the loyalty result is revealed by LadyResultReveal.
 */
export function LadyOfLake({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const holderId = game.lady?.holderId ?? null;
  const isHolder = holderId === myPlayerId;
  const nameOf = (id: string) => labelById(game, id);

  return (
    <div className="text-center">
      <span className="text-3xl">🌊</span>
      <h3 className="font-serif text-lg text-sky-300">{t('lady.title')}</h3>
      <p className="text-sm text-parchment/60">
        {isHolder
          ? t('lady.chooseExamine')
          : t('lady.gazingWaters', { name: nameOf(holderId ?? '') })}
      </p>
    </div>
  );
}
