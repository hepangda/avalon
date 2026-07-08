'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { ROLE_SIGIL, ROLE_TEAM_UI, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, VisibilityInfo } from '@/lib/engine';

/**
 * The viewer's identity hole-card, for the hand. Shown face-down (crest); a tap
 * opens the full modal with the role, blurb and what you perceive about others
 * (reads from game.selfRole / game.knownPlayers, reliable across reconnects).
 */
export function IdentityCard({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const role = game.selfRole;
  if (!role) return null; // spectators have no role
  const team = ROLE_TEAM_UI[role];
  const nameOf = (id: string) => labelById(game, id);

  function shownLabel(shownAs: VisibilityInfo['shownAs']): string {
    if (shownAs === 'evil') return t('roleReveal.shownEvil');
    if (shownAs === 'merlin-or-morgana') return t('roleReveal.shownMerlinOrMorgana');
    return t('roleReveal.shownAlly');
  }

  const overlay = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[55] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/70" />
          <motion.div
            className="panel relative max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto p-5 text-center"
            initial={{ scale: 0.8, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full border-4 ${
                team === 'evil' ? 'border-crimson/60' : 'border-sky-400/50'
              } bg-ink/50 shadow-candle`}
            >
              <span className="text-5xl">{ROLE_SIGIL[role]}</span>
            </div>
            <div>
              <h2 className="gilt text-2xl">{roleText.name(role)}</h2>
              <p className={`text-xs uppercase tracking-wide ${TEAM_COLOR[team]}`}>
                {roleText.teamLabel(team)}
              </p>
            </div>
            <p className="text-sm text-parchment/70">{roleText.blurb(role)}</p>

            <div className="rounded-lg border border-gold/20 bg-ink/40 p-3 text-left">
              <p className="mb-1 text-xs uppercase tracking-wide text-parchment/50">
                {t('roleReveal.whatYouPerceive')}
              </p>
              {game.knownPlayers.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {game.knownPlayers.map((k) => (
                    <li key={k.playerId} className="flex items-center justify-between">
                      <span className="text-parchment">{nameOf(k.playerId)}</span>
                      <span className="text-xs text-parchment/60">{shownLabel(k.shownAs)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-parchment/50">{t('roleReveal.seeNothing')}</p>
              )}
            </div>

            <button
              className="w-full rounded-md border border-gold/40 bg-stone/80 py-2 text-sm text-parchment hover:border-gold/80"
              onClick={() => setOpen(false)}
            >
              {t('mission.close')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('identity.myRole')}
        className="flex shrink-0 flex-col items-center gap-1"
      >
        <span className="relative flex h-[4.6rem] w-[3.3rem] items-center justify-center rounded-lg border-2 border-gold/40 bg-gradient-to-br from-royal to-ink shadow-lg shadow-black/40 transition-shadow hover:shadow-candle">
          <span className="absolute inset-1.5 rounded-md border border-gold/20" />
          <span
            className="text-2xl text-gold/85"
            style={{ textShadow: '0 0 12px rgba(201,162,39,0.45)' }}
          >
            ⚜
          </span>
        </span>
        <span className="text-[10px] text-parchment/55">{t('identity.myRole')}</span>
      </button>
      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

