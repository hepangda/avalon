'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { gameActions } from '@/lib/socket/client';
import { labelById, seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

export function VotePanel({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const [voted, setVoted] = useState<'approve' | 'reject' | null>(null);
  const team = game.proposedTeam ?? [];
  const leader = game.players.find((p) => p.seat === game.leaderIndex);
  const nameOf = (id: string) => labelById(game, id);

  const myVoteState = game.votes?.find((v) => v.playerId === myPlayerId);
  const alreadyVoted = voted !== null || myVoteState?.hasVoted;
  const allIn = (game.votes ?? []).every((v) => v.hasVoted);
  const votesRevealed = allIn && (game.votes ?? []).some((v) => v.vote !== undefined);

  async function cast(value: 'approve' | 'reject') {
    setVoted(value);
    const res = await gameActions.vote(value);
    if (!res.ok) setVoted(null);
  }

  return (
    <Card className="space-y-4">
      <div className="text-center">
        <h2 className="font-serif text-xl text-gold">{t('vote.title')}</h2>
        <p className="text-sm text-parchment/60">
          {t('vote.proposesFor', {
            name: leader ? seatLabel(leader.seat, leader.name) : '...',
            round: game.roundIndex + 1,
          })}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {team.map((id) => (
          <span
            key={id}
            className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-sm text-parchment"
          >
            {nameOf(id)}
          </span>
        ))}
      </div>

      {!alreadyVoted ? (
        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => cast('approve')}>
            👍 {t('vote.approve')}
          </Button>
          <Button variant="danger" className="flex-1" onClick={() => cast('reject')}>
            👎 {t('vote.reject')}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-parchment/60">
          {votesRevealed ? t('vote.decided') : t('vote.castWaiting')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {(game.votes ?? []).map((v) => (
          <motion.div
            key={v.playerId}
            initial={false}
            animate={{ opacity: v.hasVoted ? 1 : 0.4 }}
            className="flex items-center justify-between rounded-md border border-gold/15 bg-ink/30 px-2 py-1 text-xs"
          >
            <span className="truncate text-parchment/80">{nameOf(v.playerId)}</span>
            <span>
              {v.vote === 'approve' ? '👍' : v.vote === 'reject' ? '👎' : v.hasVoted ? '✓' : '…'}
            </span>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
