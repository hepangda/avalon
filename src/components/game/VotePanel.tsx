'use client';

import { useTranslations } from 'use-intl';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

/**
 * Voting status for the table's centre board. The approve/reject cards live in
 * the player's hand (HandArea); this just shows who proposed and how many votes
 * are in (or that the vote has been decided).
 */
export function VotePanel({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const leader = game.players.find((p) => p.seat === game.leaderIndex);

  const votes = game.votes ?? [];
  const votedCount = votes.filter((v) => v.hasVoted).length;
  const total = game.players.length;
  const allIn = votes.length > 0 && votes.every((v) => v.hasVoted);
  const votesRevealed = allIn && votes.some((v) => v.vote !== undefined);
  const myVoted = !!votes.find((v) => v.playerId === myPlayerId)?.hasVoted;

  return (
    <div className="space-y-1.5 text-center">
      <p className="text-sm text-parchment/60">
        {t('vote.proposesFor', {
          name: leader ? seatLabel(leader.seat, leader.name) : '...',
          round: game.roundIndex + 1,
        })}
      </p>
      <p className="text-xs tabular-nums text-parchment/45">
        {votesRevealed ? (
          t('vote.decided')
        ) : (
          <>
            🗳️ {votedCount}/{total}
            {myVoted && !game.isSpectator ? ` · ${t('vote.castWaiting')}` : ''}
          </>
        )}
      </p>
    </div>
  );
}
