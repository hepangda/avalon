'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { VoteResultPanel } from './VoteResultPanel';
import { MissionCardReveal } from './MissionCardReveal';
import type { ClientGameState } from '@/lib/engine';

/**
 * Modal showing a single round's full history: every proposal vote for that
 * round (approved & rejected) and the mission outcome. Opened by tapping a
 * quest on the MissionTrack. `roundIndex` null = closed.
 */
export function RoundHistoryModal({
  roundIndex,
  game,
  onClose,
}: {
  roundIndex: number | null;
  game: ClientGameState;
  onClose: () => void;
}) {
  const t = useTranslations();
  const open = roundIndex !== null;
  const votes = open ? game.voteHistory.filter((v) => v.roundIndex === roundIndex) : [];
  const result = open ? game.missionResults.find((m) => m.roundIndex === roundIndex) : undefined;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-gold/40 bg-stone/95 p-4 shadow-2xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif text-lg text-gold">
                {t('mission.roundDetail', { n: (roundIndex ?? 0) + 1 })}
              </h3>
              <button
                className="text-parchment/50 hover:text-parchment"
                onClick={onClose}
                aria-label={t('mission.close')}
              >
                ✕
              </button>
            </div>

            {/* Mission outcome — title + revealed cards, matching the cue. */}
            <div className="mb-3 rounded-lg border border-gold/15 bg-ink/30 p-3">
              {result ? (
                <div className="space-y-2">
                  <p
                    className={`text-center font-serif text-lg ${
                      result.success ? 'text-sky-300' : 'text-crimson'
                    }`}
                  >
                    {result.success ? t('missionResult.succeeds') : t('missionResult.sabotaged')}
                  </p>
                  <MissionCardReveal
                    teamSize={result.teamSize}
                    failCount={result.failCount}
                    instant
                  />
                </div>
              ) : (
                <p className="text-center text-sm text-parchment/50">{t('mission.notPlayed')}</p>
              )}
            </div>

            {/* Votes this round */}
            <p className="mb-1.5 text-xs uppercase tracking-wide text-parchment/50">
              {t('mission.votesThisRound')}
            </p>
            {votes.length > 0 ? (
              <div className="space-y-3">
                {votes.map((v) => (
                  <div
                    key={v.proposalIndex}
                    className="rounded-lg border border-gold/10 bg-ink/20 p-2.5"
                  >
                    <VoteResultPanel record={v} game={game} compact showProposalLabel />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-parchment/50">{t('mission.noHistory')}</p>
            )}

            <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>
              {t('mission.close')}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
