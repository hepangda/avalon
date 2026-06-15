'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PlayerRing } from './PlayerRing';
import { gameActions } from '@/lib/socket/client';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

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
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < teamSize ? [...cur, id] : cur,
    );
  }

  async function propose() {
    setSubmitting(true);
    setError(null);
    const res = await gameActions.proposeTeam(selected);
    if (!res.ok && res.error) setError(res.error.message);
    setSubmitting(false);
  }

  return (
    <Card className="space-y-4">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-parchment/50">
          {t('teamBuilder.proposalOf', { n: game.rejectionCount + 1 })}
        </p>
        <h2 className="font-serif text-xl text-gold">
          {isLeader
            ? t('teamBuilder.youLead')
            : t('teamBuilder.leaderChoosing', {
                name: leader ? seatLabel(leader.seat, leader.name) : '...',
              })}
        </h2>
        <p className="text-sm text-parchment/60">
          {t('teamBuilder.selectKnights', { size: teamSize, round: game.roundIndex + 1 })}
        </p>
      </div>

      <PlayerRing
        game={game}
        myPlayerId={myPlayerId}
        selectable={isLeader}
        selectedIds={selected}
        onToggle={toggle}
      />

      {isLeader && (
        <>
          <Button
            className="w-full"
            onClick={propose}
            disabled={selected.length !== teamSize || submitting}
          >
            {selected.length === teamSize
              ? t('teamBuilder.proposeTeam')
              : t('teamBuilder.chooseMore', { n: teamSize - selected.length })}
          </Button>
          {error && <p className="text-center text-sm text-crimson">{error}</p>}
        </>
      )}
    </Card>
  );
}
