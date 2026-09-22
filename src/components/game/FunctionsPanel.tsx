'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { AdminPanel } from '@/components/game/AdminPanel';
import { GameIcon } from '@/components/game/GameArt';
import { gameActions, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import type { ClientGameState } from '@/lib/engine';

/**
 * Contents of the game tools' "functions" sheet: out-of-band actions surfaced
 * as buttons — early assassination, referee tools, and leaving the room.
 * Irreversible actions use a two-tap confirm to avoid misclicks.
 * Rendered inline by GameTools; overlays portal to document.body so
 * they escape the panel's clipping/stacking context (e.g. its tall mode).
 */
export function FunctionsPanel({
  code,
  game,
  onAssassinationStarted,
}: {
  code: string;
  game: ClientGameState;
  onAssassinationStarted: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmAssassination, setConfirmAssassination] = useState(false);
  const [startingAssassination, setStartingAssassination] = useState(false);
  const [assassinationError, setAssassinationError] = useState<string | null>(null);
  const assassinationInFlight = useRef(false);
  const assassinationDialogRef = useRef<HTMLDivElement>(null);
  const assassinationActionRef = useRef<HTMLButtonElement>(null);
  const cancelAssassinationRef = useRef<HTMLButtonElement>(null);
  const confirmAssassinationRef = useRef<HTMLButtonElement>(null);
  const assassinationDialogId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!game.canStartAssassination) {
      setConfirmAssassination(false);
      setAssassinationError(null);
    }
  }, [game.canStartAssassination]);

  function cancelAssassination() {
    if (assassinationInFlight.current) return;
    setConfirmAssassination(false);
    setAssassinationError(null);
    assassinationActionRef.current?.focus();
  }

  async function handleStartAssassination() {
    if (!confirmAssassination || !game.canStartAssassination || assassinationInFlight.current) {
      return;
    }
    assassinationInFlight.current = true;
    assassinationDialogRef.current?.focus();
    setStartingAssassination(true);
    setAssassinationError(null);
    try {
      const res = await gameActions.startAssassination();
      if (res.ok) {
        setConfirmAssassination(false);
        onAssassinationStarted();
      } else {
        setAssassinationError(res.error?.message ?? t('assassin.startFailed'));
      }
    } catch (error) {
      setAssassinationError(
        error instanceof Error && error.message ? error.message : t('assassin.startFailed'),
      );
    } finally {
      assassinationInFlight.current = false;
      setStartingAssassination(false);
    }
  }

  async function handleLeave() {
    // Leaving frees (unbinds) our seat server-side; clear the local session so a
    // later visit doesn't auto-rejoin it, then go home.
    await roomActions.leave();
    const { useSessionStore } = await import('@/lib/store/session');
    useSessionStore
      .getState()
      .setSession(code, { playerId: undefined, playerToken: undefined });
    useRoomStore.getState().reset();
    router.push('/');
  }

  return (
    <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      {game.canStartAssassination && (
        <button
          ref={assassinationActionRef}
          type="button"
          disabled={startingAssassination}
          onClick={() => {
            setAssassinationError(null);
            setConfirmAssassination(true);
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-crimson/40 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson hover:bg-crimson/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GameIcon name="reject" className="h-8 w-8" />
          <span className="min-w-0 flex-1 text-sm font-semibold text-parchment">
            {t('assassin.startEarly')}
          </span>
        </button>
      )}

      {!game.isSpectator && <AdminPanel game={game} />}

      <button
        onClick={() => setConfirmLeave(true)}
        className="flex w-full items-center gap-3 rounded-lg border border-gold/20 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson/60 hover:bg-crimson/5"
      >
        <span className="flex w-8 shrink-0 justify-center text-2xl">🚪</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-crimson">
          {t('game.leaveSeat')}
        </span>
      </button>

      {confirmAssassination &&
        game.canStartAssassination &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
            <div
              ref={assassinationDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${assassinationDialogId}-title`}
              aria-describedby={`${assassinationDialogId}-consequences`}
              aria-busy={startingAssassination}
              className="max-h-[calc(100dvh-1.5rem)] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl border border-crimson/40 bg-ink-deep p-4 shadow-xl"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  cancelAssassination();
                } else if (event.key === 'Tab') {
                  if (startingAssassination) {
                    event.preventDefault();
                  } else if (event.target === event.currentTarget) {
                    event.preventDefault();
                    (event.shiftKey ? confirmAssassinationRef : cancelAssassinationRef).current?.focus();
                  } else if (event.shiftKey && event.target === cancelAssassinationRef.current) {
                    event.preventDefault();
                    confirmAssassinationRef.current?.focus();
                  } else if (!event.shiftKey && event.target === confirmAssassinationRef.current) {
                    event.preventDefault();
                    cancelAssassinationRef.current?.focus();
                  }
                }
              }}
            >
              <h2 id={`${assassinationDialogId}-title`} className="font-serif text-lg text-gold">
                {t('assassin.startEarly')}
              </h2>
              <div
                id={`${assassinationDialogId}-consequences`}
                className="space-y-3 text-sm text-parchment/80"
              >
                <p>{t('assassin.earlyConsequences')}</p>
                <p>{t('assassin.earlyOutcome')}</p>
                <p className="font-semibold text-parchment">{t('assassin.irreversible')}</p>
              </div>
              {assassinationError && (
                <p
                  role="alert"
                  className="rounded-lg border border-crimson/50 bg-crimson/20 px-3 py-2 text-sm text-parchment"
                >
                  {assassinationError}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <Button
                  ref={cancelAssassinationRef}
                  type="button"
                  variant="ghost"
                  className="border border-gold/20"
                  autoFocus
                  disabled={startingAssassination}
                  onClick={cancelAssassination}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  ref={confirmAssassinationRef}
                  type="button"
                  variant="danger"
                  disabled={startingAssassination}
                  onClick={() => void handleStartAssassination()}
                >
                  {startingAssassination ? t('assassin.starting') : t('assassin.confirmStart')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {confirmLeave &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
            <div className="w-full max-w-xs space-y-4 rounded-xl border border-crimson/40 bg-ink-deep p-4 shadow-xl">
              <p className="text-center text-sm text-parchment/80">{t('game.confirmLeave')}</p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 border border-gold/20"
                  onClick={() => setConfirmLeave(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button variant="danger" className="flex-1" onClick={() => void handleLeave()}>
                  {t('game.leaveSeat')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

    </div>
  );
}
