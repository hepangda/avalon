'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ROLE_SIGIL, ROLE_TEAM_UI, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, VisibilityInfo } from '@/lib/engine';

/**
 * A persistent "My Role" button + modal so players can re-check their secret
 * identity and what they perceive at any time during the game. Reads from the
 * always-present game.selfRole / game.knownPlayers (reliable across reconnects),
 * not the one-shot reveal event.
 *
 * The fullscreen overlay is rendered through a portal to document.body so it
 * escapes any ancestor that creates a containing block for position:fixed
 * (e.g. the header Card uses backdrop-blur, which would otherwise trap it).
 */
export function MyIdentityButton({
  game,
}: {
  game: ClientGameState;
}) {
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
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-stone/70 px-3 py-1.5 text-xs text-parchment hover:border-gold/80 hover:shadow-candle"
      >
        {t('identity.myRole')}
      </button>
      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}
