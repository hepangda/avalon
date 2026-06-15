'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { AdminPanel } from '@/components/game/AdminPanel';
import { roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import type { ClientGameState } from '@/lib/engine';

/**
 * Contents of the war-log's "functions" channel: out-of-band actions surfaced
 * as buttons — referee tools (the AdminPanel) and leaving the room. Leaving
 * frees (unbinds) this player's seat, so it uses a two-tap confirm to avoid
 * misclicks. Rendered inline by LogPanel; overlays portal to document.body so
 * they escape the panel's clipping/stacking context (e.g. its tall mode).
 */
export function FunctionsPanel({ code, game }: { code: string; game: ClientGameState }) {
  const t = useTranslations();
  const router = useRouter();
  const [adminOpen, setAdminOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleLeave() {
    // Leaving frees (unbinds) our seat server-side; clear the local session so a
    // later visit doesn't auto-rejoin it, then go home.
    await roomActions.leave();
    const { useSessionStore } = await import('@/lib/store/session');
    useSessionStore.getState().setSession(code, { playerId: undefined });
    useRoomStore.getState().reset();
    router.push('/');
  }

  return (
    <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      {!game.isSpectator && (
        <button
          onClick={() => setAdminOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg border border-gold/20 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-gold/60 hover:bg-gold/5"
        >
          <span className="flex w-8 shrink-0 justify-center text-2xl">🛠</span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-parchment">
            {t('game.refereeTools')}
          </span>
        </button>
      )}

      <button
        onClick={() => setConfirmLeave(true)}
        className="flex w-full items-center gap-3 rounded-lg border border-gold/20 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson/60 hover:bg-crimson/5"
      >
        <span className="flex w-8 shrink-0 justify-center text-2xl">🚪</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-crimson">
          {t('game.leaveSeat')}
        </span>
      </button>

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

      <AdminPanel game={game} open={adminOpen} onClose={() => setAdminOpen(false)} />
    </div>
  );
}
