'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, Team } from '@/lib/engine';

/**
 * The Lady of the Lake's private result, shown as a card that flips to reveal
 * the inspected player's allegiance — good (blue) or evil (crimson). Only the
 * holder sees it (the result is private); tap to dismiss. This gives the
 * inspection a proper reveal instead of only a war-log line.
 */
export function LadyResultReveal({
  game,
  result,
  onClose,
}: {
  game: ClientGameState;
  result: { targetId: string; loyalty: Team };
  onClose: () => void;
}) {
  const t = useTranslations();
  const reduce = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const id = setTimeout(() => setFlipped(true), reduce ? 0 : 550);
    return () => clearTimeout(id);
  }, [reduce]);

  const evil = result.loyalty === 'evil';
  const name = labelById(game, result.targetId);

  const overlay = (
    <motion.div
      className="fixed inset-0 z-[55] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/65" />
      <motion.div
        className="panel relative w-full max-w-xs space-y-4 p-5 text-center"
        initial={{ scale: 0.8, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <span className="text-3xl">🌊</span>
          <p className="mt-1 text-sm text-parchment/70">{t('lady.watersReveal', { name })}</p>
        </div>

        {/* The loyalty card flips face-up. */}
        <div className="mx-auto h-32 w-24" style={{ perspective: 1000 }}>
          <motion.div
            className="relative h-full w-full"
            style={{ transformStyle: 'preserve-3d' }}
            initial={false}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center rounded-xl border-2 border-sky-300/50 bg-gradient-to-br from-royal to-ink"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <span className="text-4xl text-sky-200/70">🌊</span>
            </div>
            <div
              className={cn(
                'absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl border-2',
                evil ? 'border-crimson bg-crimson/30' : 'border-sky-300 bg-sky-600/30',
              )}
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <span className="text-4xl">{evil ? '🗡️' : '🛡️'}</span>
              <span className={cn('font-serif text-xl', evil ? 'text-crimson-bright' : 'text-sky-200')}>
                {evil ? t('team.evil') : t('team.good')}
              </span>
            </div>
          </motion.div>
        </div>

        <p className="text-xs text-parchment/40">{t('lady.onlyYouSeen')}</p>
        <button
          className="w-full rounded-md border border-gold/40 bg-stone/80 py-2 text-sm text-parchment hover:border-gold/80"
          onClick={onClose}
        >
          {t('mission.close')}
        </button>
      </motion.div>
    </motion.div>
  );

  if (!mounted) return null;
  return createPortal(<AnimatePresence>{overlay}</AnimatePresence>, document.body);
}
