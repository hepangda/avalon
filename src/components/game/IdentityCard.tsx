'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';
import { RoleKnowledge } from './RoleKnowledge';
import type { ClientGameState } from '@/lib/engine';

/** Private identity stays face-down until its owner opens the full card. */
export function IdentityCard({
  game,
  myPlayerId,
  compact = false,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
  compact?: boolean;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const role = game.selfRole;
  const variant = game.players.find((p) => p.id === myPlayerId)?.roleVariant;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
  }, [open]);

  if (!role) return null;


  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('identity.myRole')}
        aria-haspopup="dialog"
        className={compact ? 'table-tool' : 'flex shrink-0 flex-col items-center gap-1'}
      >
        {compact ? (
          <GameIcon name="crest" className="h-5 w-5" />
        ) : (
          <span className="relative flex h-[4.6rem] w-[3.3rem] items-center justify-center rounded-lg border-2 border-gold/40 bg-gradient-to-br from-royal to-ink shadow-lg shadow-black/40 transition-shadow hover:shadow-candle">
            <span className="absolute inset-1.5 rounded-md border border-gold/20" />
            <GameIcon name="crest" className="h-9 w-9 drop-shadow-[0_0_10px_rgba(201,162,39,0.45)]" />
          </span>
        )}
        <span className={compact ? '' : 'text-[10px] text-parchment/55'}>
          {t(compact ? 'table.identity' : 'identity.myRole')}
        </span>
      </button>
      {createPortal(
        <dialog
          ref={dialogRef}
          className="identity-dialog"
          aria-label={t('identity.myRole')}
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <motion.div
            className="identity-scrim"
            aria-hidden="true"
            initial={false}
            animate={open ? 'revealed' : 'hidden'}
            variants={{
              revealed: { opacity: 1, transition: { duration: reduceMotion ? 0.12 : 0.2 } },
              hidden: {
                opacity: 0,
                transition: { duration: reduceMotion ? 0.12 : 0.44, ease: 'easeInOut' },
              },
            }}
            onAnimationComplete={(state) => {
              // The scrim outlasts the card so removing the native modal is invisible.
              if (state === 'hidden' && !open && dialogRef.current?.open) {
                dialogRef.current.close();
              }
            }}
          />
          <div className="identity-content">
            <div className="identity-card-frame">
              <motion.div
                className="identity-card-pop"
                initial={false}
                animate={open ? 'revealed' : 'hidden'}
                variants={{
                  revealed: {
                    opacity: 1, scale: 1, y: 0,
                    transition: {
                      duration: reduceMotion ? 0.12 : 0.44,
                      ease: 'easeOut',
                      opacity: { duration: 0.12 },
                    },
                  },
                  hidden: {
                    opacity: 0,
                    scale: reduceMotion ? 1 : 0.86,
                    y: reduceMotion ? 0 : 20,
                    transition: {
                      duration: reduceMotion ? 0.12 : 0.36,
                      ease: 'easeInOut',
                      opacity: { duration: reduceMotion ? 0.12 : 0.24, delay: reduceMotion ? 0 : 0.08 },
                    },
                  },
                }}
              >
                <motion.div
                  className="identity-card-rotor"
                  variants={{
                    revealed: {
                      rotateY: 0,
                      transition: { duration: reduceMotion ? 0 : 0.44, ease: 'easeOut' },
                    },
                    hidden: {
                      rotateY: reduceMotion ? 0 : 180,
                      transition: { duration: reduceMotion ? 0 : 0.36, ease: 'easeInOut' },
                    },
                  }}
                >
                  <div className="identity-card-face">
                    <RoleCard role={role} variant={variant} />
                  </div>
                  <div className="identity-card-face identity-card-back" aria-hidden="true">
                    <GameIcon name="crest" className="w-1/3 drop-shadow-[0_0_16px_rgba(201,162,39,0.35)]" />
                  </div>
                </motion.div>
              </motion.div>
            </div>
            {game.knownPlayers.length > 0 && (
              <motion.div
                className="identity-perception"
                initial={false}
                animate={{ opacity: open ? 1 : 0 }}
                transition={{ duration: 0.12, delay: open && !reduceMotion ? 0.22 : 0 }}
              >
                <RoleKnowledge game={game} knownPlayers={game.knownPlayers} />
              </motion.div>
            )}
          </div>
          <motion.button
            type="button"
            className="identity-close"
            onClick={() => setOpen(false)}
            aria-label={t('mission.close')}
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.12 }}
          >
            ✕
          </motion.button>
        </dialog>,
        document.body,
      )}
    </>
  );
}
