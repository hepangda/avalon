import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';
import { RoleKnowledge } from './RoleKnowledge';
import { flyFromChip, flyToChip } from './cardFlight';
import type { ClientGameState } from '@/lib/engine';

/** Private identity stays face down in the dock; opening it lifts the card out, closing puts it back. */
export function IdentityCard({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  /** The card is out of the chip, from the moment it lifts until it lands again. */
  const [out, setOut] = useState(false);
  const closing = useRef(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const role = game.selfRole;
  const variant = game.players.find((p) => p.id === myPlayerId)?.roleVariant;

  // Show the dialog first so the card has a resting place to fly to.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const pop = popRef.current;
    const rotor = rotorRef.current;
    if (!open || !dialog || !pop || !rotor || dialog.open) return;
    dialog.showModal();
    void flyFromChip(pop, rotor, chipRef.current, reduceMotion ? 0 : 0.55);
  }, [open, reduceMotion]);

  async function close() {
    const dialog = dialogRef.current;
    const pop = popRef.current;
    const rotor = rotorRef.current;
    if (closing.current || !dialog?.open || !pop || !rotor) return;
    closing.current = true;
    setOpen(false);
    await flyToChip(pop, rotor, chipRef.current, reduceMotion ? 0 : 0.7);
    dialog.close();
    rotor.style.transform = 'rotateY(180deg)';
    setOut(false);
    closing.current = false;
  }

  if (!role) return null;

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        onClick={() => {
          if (closing.current) return;
          setOut(true);
          setOpen(true);
        }}
        title={t('identity.myRole')}
        aria-haspopup="dialog"
        aria-label={t('identity.myRole')}
        className="identity-chip"
        data-out={out || undefined}
      >
        <GameIcon name="crest" className="identity-chip-crest" />
      </button>
      {createPortal(
        <dialog
          ref={dialogRef}
          className="identity-dialog"
          aria-label={t('identity.myRole')}
          onCancel={(event) => {
            event.preventDefault();
            void close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) void close();
          }}
        >
          <motion.div
            className="identity-scrim"
            aria-hidden="true"
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: reduceMotion ? 0.12 : open ? 0.25 : 0.55, ease: 'easeInOut' }}
          />
          <div className="identity-content">
            <div className="identity-card-frame">
              <div ref={popRef} className="identity-card-pop" style={{ opacity: 0 }}>
                <div ref={rotorRef} className="identity-card-rotor" style={{ transform: 'rotateY(180deg)' }}>
                  <div className="identity-card-face">
                    <RoleCard role={role} variant={variant} />
                  </div>
                  <div className="identity-card-face identity-card-back" aria-hidden="true">
                    <GameIcon name="crest" className="w-1/3 drop-shadow-[0_0_16px_rgba(201,162,39,0.35)]" />
                  </div>
                </div>
              </div>
            </div>
            {game.knownPlayers.length > 0 && (
              <motion.div
                className="identity-perception"
                initial={false}
                animate={{ opacity: open ? 1 : 0 }}
                transition={{ duration: 0.18, delay: open && !reduceMotion ? 0.35 : 0 }}
              >
                <RoleKnowledge game={game} knownPlayers={game.knownPlayers} />
              </motion.div>
            )}
          </div>
          <motion.button
            type="button"
            className="identity-close"
            onClick={() => void close()}
            aria-label={t('mission.close')}
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.15, delay: open && !reduceMotion ? 0.3 : 0 }}
          >
            ✕
          </motion.button>
        </dialog>,
        document.body,
      )}
    </>
  );
}
