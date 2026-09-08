'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { PickPile } from './PickPile';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import type { ClientGameState } from '@/lib/engine';

/**
 * Public evil identity cards and the assassination prompt for the centre board.
 * The assassin chooses a target from their hand; table seats remain unchanged.
 */
export function AssassinPanel({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const isAssassin = !!game.assassinCandidates;
  const evilIds = game.players
    .filter((player) => player.role && ROLE_TEAM_UI[player.role] === 'evil')
    .map((player) => player.id);

  return (
    <motion.div
      className="text-center"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GameIcon name="reject" className="mx-auto h-12 w-12" />
      <h3 className="font-serif text-xl text-crimson">{t('assassin.title')}</h3>
      <p className="text-sm text-parchment/60">
        {isAssassin ? t('assassin.nameMerlin') : t('assassin.contemplating')}
      </p>
      <div className="mt-3" role="group" aria-label={t('assassin.identitiesPublic')}>
        <PickPile game={game} selected={evilIds} size={evilIds.length} tone="crimson" revealRoles />
      </div>
      <p className="mt-2 text-xs text-parchment/70">{t('assassin.identitiesPublic')}</p>
    </motion.div>
  );
}
