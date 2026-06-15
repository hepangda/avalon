'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import type { ClientGameState } from '@/lib/engine';

/**
 * In-game seat claim for unseated viewers (spectators / latecomers). Lists the
 * roster seats nobody holds (claimed === false) so a late joiner can take one
 * and start playing. Claiming flips this client to that seat; the role-reveal
 * overlay then appears because the new seat isn't in roleAcks yet.
 */
export function InGameSeatClaim({ code, game }: { code: string; game: ClientGameState }) {
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const openSeats = game.players
    .filter((p) => p.claimed === false)
    .sort((a, b) => a.seat - b.seat);
  if (openSeats.length === 0) return null;

  async function claim(seatId: string) {
    setBusy(seatId);
    setError(null);
    const res = await roomActions.claimSeat(seatId);
    setBusy(null);
    if (res.ok && res.data) {
      useRoomStore.getState().setMyPlayerId(res.data.playerId);
      const { useSessionStore } = await import('@/lib/store/session');
      useSessionStore.getState().setSession(code, { playerId: res.data.playerId });
    } else if (res.error) {
      setError(res.error.message);
    }
  }

  return (
    <div className="rounded-lg border border-gold/30 bg-gold/10 p-3">
      <p className="mb-2 text-center text-sm text-gold">{t('seat.claimToJoin')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {openSeats.map((s) => (
          <button
            key={s.id}
            disabled={busy !== null}
            onClick={() => claim(s.id)}
            className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-ink/40 px-3 py-1.5 text-sm text-parchment transition-colors hover:border-gold disabled:opacity-50"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold/20 text-xs text-gold">
              {s.seat + 1}
            </span>
            {s.name}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-center text-xs text-crimson">{error}</p>}
    </div>
  );
}
