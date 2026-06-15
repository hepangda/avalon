'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { latencyDotClass } from '@/lib/utils/latency';
import { seatLabel } from '@/lib/game/playerLabel';
import type { RoomMember } from '@/lib/socket/types';

interface SeatPickerProps {
  members: RoomMember[];
  myPlayerId: string | null;
  onClaim: (seatId: string) => void;
  onSpectate: () => void;
}

/**
 * "Who are you?" — lets a joiner claim an unclaimed roster seat, switch to
 * another free seat, or choose to spectate. A seat held by someone else is
 * disabled; the seat the viewer currently holds is highlighted.
 */
export function SeatPicker({ members, myPlayerId, onClaim, onSpectate }: SeatPickerProps) {
  const t = useTranslations();
  const seats = members.filter((m) => !m.isSpectator);
  const mine = myPlayerId ? seats.find((s) => s.id === myPlayerId) : undefined;

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl text-gold">{t('seat.whoAreYou')}</h2>
        {mine && (
          <span className="text-xs text-parchment/50">
            {t('seat.youAreNow', { name: seatLabel(mine.seat, mine.name) })}
          </span>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {seats.map((s) => {
          const isMine = s.id === myPlayerId;
          const takenByOther = s.claimed && !isMine;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={takenByOther}
                onClick={() => !isMine && onClaim(s.id)}
                className={[
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                  isMine
                    ? 'border-gold bg-gold/20'
                    : takenByOther
                      ? 'cursor-not-allowed border-gold/10 bg-ink/20 opacity-50'
                      : 'cursor-pointer border-gold/15 bg-ink/30 hover:border-gold/60',
                ].join(' ')}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/20 text-xs text-gold">
                  {s.seat + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-parchment">{s.name}</span>
                {s.claimed && (
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${latencyDotClass(s.connected, s.latency)}`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        className="mx-auto block text-xs text-parchment/50 underline-offset-2 hover:text-parchment/80 hover:underline"
        onClick={onSpectate}
      >
        {mine ? t('seat.leaveSeatSpectate') : t('seat.spectate')}
      </button>
    </Card>
  );
}
