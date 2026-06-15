'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PlayerRing } from './PlayerRing';
import { gameActions } from '@/lib/socket/client';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

export function AssassinPanel({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const candidates = game.assassinCandidates;
  const isAssassin = !!candidates;
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameOf = (id: string) => labelById(game, id);

  async function strike() {
    if (!selected) return;
    setSubmitting(true);
    await gameActions.assassinate(selected);
    setSubmitting(false);
  }

  return (
    <Card className="space-y-4">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="text-4xl">🗡️</span>
        <h2 className="font-serif text-2xl text-crimson">{t('assassin.title')}</h2>
        <p className="text-sm text-parchment/60">{t('assassin.goodPrevailed')}</p>
      </motion.div>

      {isAssassin ? (
        <div className="space-y-3">
          <p className="text-center text-sm text-parchment/70">{t('assassin.nameMerlin')}</p>
          <PlayerRing
            game={game}
            myPlayerId={myPlayerId}
            selectable
            candidateIds={candidates}
            selectedIds={selected ? [selected] : []}
            onToggle={(id) => setSelected((cur) => (cur === id ? null : id))}
          />
          <Button
            variant="danger"
            className="w-full"
            onClick={strike}
            disabled={!selected || submitting}
          >
            {selected ? t('assassin.strikeDown', { name: nameOf(selected) }) : t('assassin.chooseTarget')}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-parchment/50">{t('assassin.contemplating')}</p>
      )}
    </Card>
  );
}
