'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { VoteResultPanel } from './VoteResultPanel';
import type { ClientGameState } from '@/lib/engine';

/** Brief reveal of the just-completed mission's outcome (success/fail + count). */
export function MissionResult({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const last = game.missionResults.at(-1);
  if (!last) return null;

  // The approved vote that sent this mission (for the result panel).
  const approvedVote = game.voteHistory
    .filter((v) => v.roundIndex === last.roundIndex && v.approved)
    .at(-1);

  return (
    <div className="space-y-4 text-center">
      <h3 className="font-serif text-lg text-gold">
        {t('missionResult.resolved', { round: last.roundIndex + 1 })}
      </h3>

      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full border-4 ${
          last.success ? 'border-sky-300 bg-sky-600/40' : 'border-crimson bg-crimson/40'
        }`}
      >
        <span className="text-5xl">{last.success ? '✅' : '❌'}</span>
      </motion.div>

      <p className="font-serif text-2xl text-parchment">
        {last.success ? t('missionResult.succeeds') : t('missionResult.sabotaged')}
      </p>
      <p className="text-sm text-parchment/60">
        {t('missionResult.failCards', { count: last.failCount })}
      </p>

      {/* The vote that approved this mission. */}
      {approvedVote && (
        <div className="rounded-lg border border-gold/15 bg-ink/30 p-3 text-left">
          <p className="mb-1.5 text-xs uppercase tracking-wide text-parchment/50">
            {t('vote.result')}
          </p>
          <VoteResultPanel record={approvedVote} game={game} compact />
        </div>
      )}

      <p className="text-xs text-parchment/40">{t('missionResult.nextSoon')}</p>
    </div>
  );
}
