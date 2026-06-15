'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PlayerRing } from './PlayerRing';
import { gameActions } from '@/lib/socket/client';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, Team } from '@/lib/engine';

export function LadyOfLake({
  game,
  myPlayerId,
  ladyResult,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
  ladyResult: { targetId: string; loyalty: Team } | null;
}) {
  const t = useTranslations();
  const holderId = game.lady?.holderId ?? null;
  const isHolder = holderId === myPlayerId;
  const inspected = game.lady?.inspectedIds ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameOf = (id: string) => labelById(game, id);

  const candidateIds = game.players
    .filter((p) => p.id !== holderId && !inspected.includes(p.id))
    .map((p) => p.id);

  async function inspect() {
    if (!selected) return;
    setSubmitting(true);
    await gameActions.useLady(selected);
    setSubmitting(false);
  }

  const showResult = isHolder && ladyResult && ladyResult.targetId;

  return (
    <Card className="space-y-4">
      <div className="text-center">
        <span className="text-3xl">🌊</span>
        <h2 className="font-serif text-xl text-gold">{t('lady.title')}</h2>
        <p className="text-sm text-parchment/60">
          {isHolder
            ? t('lady.chooseExamine')
            : t('lady.gazingWaters', { name: nameOf(holderId ?? '') })}
        </p>
      </div>

      <AnimatePresence mode="wait">
        {showResult ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-2 text-center"
          >
            <p className="text-sm text-parchment/60">
              {t('lady.watersReveal', { name: nameOf(ladyResult.targetId) })}
            </p>
            <p
              className={`font-serif text-3xl ${
                ladyResult.loyalty === 'evil' ? 'text-crimson' : 'text-sky-300'
              }`}
            >
              {ladyResult.loyalty === 'evil' ? t('team.evil') : t('team.good')}
            </p>
            <p className="text-xs text-parchment/40">{t('lady.onlyYouSeen')}</p>
          </motion.div>
        ) : isHolder ? (
          <motion.div key="pick" exit={{ opacity: 0 }} className="space-y-3">
            <PlayerRing
              game={game}
              myPlayerId={myPlayerId}
              selectable
              candidateIds={candidateIds}
              selectedIds={selected ? [selected] : []}
              onToggle={(id) => setSelected((cur) => (cur === id ? null : id))}
            />
            <Button className="w-full" onClick={inspect} disabled={!selected || submitting}>
              {selected ? t('lady.examine', { name: nameOf(selected) }) : t('lady.selectPlayer')}
            </Button>
          </motion.div>
        ) : (
          <p key="wait" className="text-center text-sm text-parchment/50">
            {t('lady.notYours')}
          </p>
        )}
      </AnimatePresence>
    </Card>
  );
}
