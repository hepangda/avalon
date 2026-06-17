'use client';

import { useTranslations } from 'next-intl';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

/**
 * Team-building prompt for the centre board. The leader plays player cards from
 * their hand; the nominated team shows in the central NominationPile.
 */
export function TeamBuilder({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const leader = game.players.find((p) => p.seat === game.leaderIndex);
  const isLeader = leader?.id === myPlayerId;
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;

  return (
    <div className="text-center">
      <h3 className="font-serif text-lg text-gold">
        {isLeader
          ? t('teamBuilder.youLead')
          : t('teamBuilder.leaderChoosing', {
              name: leader ? seatLabel(leader.seat, leader.name) : '...',
            })}
      </h3>
      <p className="text-sm text-parchment/60">
        {t('teamBuilder.selectKnights', { size: teamSize, round: game.roundIndex + 1 })}
      </p>
    </div>
  );
}
