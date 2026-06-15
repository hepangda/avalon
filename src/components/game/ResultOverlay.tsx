'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { VoteResultPanel } from './VoteResultPanel';
import { MissionCardReveal } from './MissionCardReveal';
import type { ClientGameState } from '@/lib/engine';
import type { ActiveCue } from '@/lib/game/cueLogic';

export type CueKind = 'voteApproved' | 'voteRejected' | 'missionSuccess' | 'missionFail';

interface CueStyle {
  icon: string;
  titleKey: string;
  subKey: string;
  accent: string;
  glow: string;
  ring: string;
}

const CUES: Record<CueKind, CueStyle> = {
  voteApproved: {
    icon: '🗳️',
    titleKey: 'cue.voteApproved',
    subKey: 'cue.voteApprovedSub',
    accent: 'text-sky-300',
    glow: 'from-sky-500/25',
    ring: 'border-sky-300',
  },
  voteRejected: {
    icon: '✊',
    titleKey: 'cue.voteRejected',
    subKey: 'cue.voteRejectedSub',
    accent: 'text-amber-300',
    glow: 'from-amber-600/25',
    ring: 'border-amber-400',
  },
  missionSuccess: {
    icon: '⚜️',
    titleKey: 'cue.missionSuccess',
    subKey: 'cue.missionSuccessSub',
    accent: 'text-sky-300',
    glow: 'from-sky-500/30',
    ring: 'border-sky-300',
  },
  missionFail: {
    icon: '🗡️',
    titleKey: 'cue.missionFail',
    subKey: 'cue.missionFailSub',
    accent: 'text-crimson-bright',
    glow: 'from-crimson/35',
    ring: 'border-crimson',
  },
};

/**
 * Full-screen result cue. Non-blocking but manually dismissed (tap anywhere or
 * the close button). Shows WHAT happened in detail: vote cues embed every
 * player's vote; mission cues show the outcome, fail count, and the approving
 * vote.
 */
export function ResultOverlay({
  cue,
  game,
  onClose,
}: {
  cue: ActiveCue | null;
  game: ClientGameState;
  onClose: () => void;
}) {
  const t = useTranslations();
  const style = cue ? CUES[cue.kind] : null;
  const isMission = cue?.kind === 'missionSuccess' || cue?.kind === 'missionFail';

  // For mission cues, the title/icon only appear AFTER the cards finish
  // flipping. Reset whenever the cue changes (keyed by kind+round).
  const [cardsRevealed, setCardsRevealed] = useState(false);
  const cueKey = cue ? `${cue.kind}-${cue.roundIndex}` : null;
  useEffect(() => {
    setCardsRevealed(false);
  }, [cueKey]);
  // Vote cues have no card phase — reveal the heading immediately.
  const headingShown = !isMission || cardsRevealed;

  // Details for this round.
  const roundVotes = cue ? game.voteHistory.filter((v) => v.roundIndex === cue.roundIndex) : [];
  const lastVote = roundVotes.at(-1);
  const approvedVote = roundVotes.filter((v) => v.approved).at(-1);
  const mission = cue
    ? game.missionResults.find((m) => m.roundIndex === cue.roundIndex)
    : undefined;

  return (
    <AnimatePresence>
      {cue && style && (
        <motion.div
          key={`${cue.kind}-${cue.roundIndex}`}
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-ink-deep" />
          {/* Coloured glow would reveal success/fail before the cards flip, so
              for mission cues it only appears once the result is shown. */}
          {headingShown && (
            <motion.div
              className={`absolute inset-0 bg-gradient-to-b ${style.glow} via-transparent to-transparent`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            />
          )}

          <motion.div
            className="relative my-auto flex w-full max-w-sm flex-col items-center gap-4 text-center"
            initial={{ scale: 0.6, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 1.05, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon + title. Votes: immediate. Missions: after the cards flip,
                rendered ABOVE the cards. */}
            <AnimatePresence>
              {headingShown && (
                <motion.div
                  key="heading"
                  className="flex flex-col items-center gap-3"
                  initial={{ scale: 0.7, opacity: 0, y: 12 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 16 }}
                >
                  <motion.div
                    className={`flex h-24 w-24 items-center justify-center rounded-full border-4 ${style.ring} bg-ink/60 shadow-candle-lg`}
                    initial={{ rotate: -12 }}
                    animate={{ rotate: [-12, 6, 0] }}
                    transition={{ duration: 0.6, times: [0, 0.6, 1] }}
                  >
                    <span className="text-5xl">{style.icon}</span>
                  </motion.div>
                  <div>
                    <h2 className={`gilt text-3xl ${style.accent}`}>{t(style.titleKey)}</h2>
                    <p className="mt-1 text-sm text-parchment/70">{t(style.subKey)}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mission cards — flip first; their header switches to "Quest
                Cards" once revealed. Stays mounted below the heading. */}
            {isMission && mission && (
              <div className="w-full panel p-3">
                <MissionCardReveal
                  teamSize={mission.teamSize}
                  failCount={mission.failCount}
                  revealed={cardsRevealed}
                  onComplete={() => setCardsRevealed(true)}
                />
              </div>
            )}

            {/* The approving vote (missions) or the vote itself (vote cues). */}
            {isMission ? (
              headingShown &&
              approvedVote && (
                <motion.div
                  className="w-full panel p-3 text-left"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <p className="mb-1 text-xs uppercase tracking-wide text-parchment/50">
                    {t('vote.result')}
                  </p>
                  <VoteResultPanel record={approvedVote} game={game} compact />
                </motion.div>
              )
            ) : (
              <div className="w-full panel p-3 text-left">
                {lastVote && <VoteResultPanel record={lastVote} game={game} compact />}
              </div>
            )}

            {/* Close — for missions, only after the reveal completes. */}
            {headingShown && (
              <motion.button
                className="rounded-md border border-gold/40 bg-stone/80 px-6 py-2 text-sm text-parchment hover:border-gold/80 hover:shadow-candle"
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                {t('mission.close')}
              </motion.button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
