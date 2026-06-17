'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import type { ClientGameState } from '@/lib/engine';

/**
 * Assassination prompt for the centre board. The assassin plays a target card
 * from their hand (HandArea); the chosen target shows in the central PickPile.
 */
export function AssassinPanel({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const isAssassin = !!game.assassinCandidates;

  return (
    <motion.div className="text-center" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
      <span className="text-3xl">🗡️</span>
      <h3 className="font-serif text-xl text-crimson">{t('assassin.title')}</h3>
      <p className="text-sm text-parchment/60">
        {isAssassin ? t('assassin.nameMerlin') : t('assassin.contemplating')}
      </p>
    </motion.div>
  );
}
