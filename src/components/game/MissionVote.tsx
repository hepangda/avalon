'use client';

import { useTranslations } from 'next-intl';
import type { ClientGameState } from '@/lib/engine';

/**
 * Mission status for the centre board. The success/fail cards live in the
 * player's hand (HandArea); this shows the prompt. Who plays what stays secret
 * (mission cards are never projected) — the result reveals in aggregate.
 */
export function MissionVote({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const team = game.proposedTeam ?? [];
  const onTeam = !!myPlayerId && team.includes(myPlayerId);

  return (
    <div className="space-y-1.5 text-center">
      <p className="text-sm text-parchment/60">
        {game.config.requiredFails[game.roundIndex] === 2
          ? t('missionVote.twoFailsNeeded')
          : t('missionVote.oneFailSpoils')}
      </p>
      {!onTeam && (
        <p className="text-xs text-parchment/45">{t('missionVote.watchAfar')}</p>
      )}
    </div>
  );
}
