'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { latencyDotClass } from '@/lib/utils/latency';
import type { Ack, RoomMember } from '@/lib/socket/types';

interface SeatPickerProps {
  members: RoomMember[];
  hostPlayerId: string;
  myPlayerId: string | null;
  isHost: boolean;
  onClaim: (seatId: string) => void;
  onStand: () => void;
  onKick: (seatId: string) => Promise<Ack>;
  onRosterChange: (names: string[]) => Promise<Ack>;
}

export function SeatPicker({
  members,
  hostPlayerId,
  myPlayerId,
  isHost,
  onClaim,
  onStand,
  onKick,
  onRosterChange,
}: SeatPickerProps) {
  const t = useTranslations();
  const seats = members.filter((m) => !m.isSpectator).sort((a, b) => a.seat - b.seat);
  const spectators = members.filter((m) => m.isSpectator);
  const serverNames = seats.map((s) => s.name);
  const [draft, setDraft] = useState<string[]>(serverNames);
  const [error, setError] = useState<string | null>(null);
  const [editingRoster, setEditingRoster] = useState(isHost);

  const serverKey = serverNames.join('\u0000');
  const lastKey = useRef(serverKey);
  useEffect(() => {
    if (lastKey.current !== serverKey) {
      lastKey.current = serverKey;
      setDraft(serverNames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  useEffect(() => {
    setEditingRoster(isHost);
  }, [isHost]);

  const fill = (names: string[]) =>
    names.map((n, i) => n.trim() || t('home.defaultSeatName', { n: i + 1 }));

  async function pushRoster(names: string[]) {
    setError(null);
    const res = await onRosterChange(fill(names));
    if (!res.ok && res.error) setError(res.error.message);
  }

  function setSeatName(i: number, value: string) {
    setDraft((d) => d.map((n, idx) => (idx === i ? value : n)));
  }

  function commitRename(i: number) {
    const next = fill(draft);
    if (next[i] !== serverNames[i]) void pushRoster(draft);
  }

  function addSeat() {
    if (draft.length >= 10) return;
    const next = [...draft, ''];
    setDraft(next);
    void pushRoster(next);
  }

  function removeSeat(i: number) {
    const seat = seats[i];
    if (!seat) return;
    if (seat.claimed) {
      setError(t('seat.removeClaimedFirst'));
      return;
    }
    const next = draft.filter((_, idx) => idx !== i);
    setDraft(next);
    void pushRoster(next);
  }

  async function askStand(seatId: string) {
    setError(null);
    const res = await onKick(seatId);
    if (!res.ok && res.error) setError(res.error.message);
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl text-gold">{t('seat.sitTitle')}</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-parchment/50">
            {t('lobby.seated', { count: seats.filter((s) => s.claimed).length })}
          </span>
          {isHost && (
            <Button
              variant={editingRoster ? 'primary' : 'secondary'}
              className="h-9 min-w-24 whitespace-nowrap border border-gold/45 px-4 text-sm font-semibold"
              onClick={() => {
                setError(null);
                setEditingRoster((v) => !v);
              }}
            >
              {editingRoster ? t('seat.doneEditing') : t('seat.editSeats')}
            </Button>
          )}
        </div>
      </div>

      {!editingRoster && !myPlayerId && (
        <p className="rounded-md border border-gold/15 bg-ink/20 px-3 py-2 text-sm text-parchment/60">
          {t('seat.spectatorSitHint')}
        </p>
      )}

      <div className="space-y-2">
        {seats.map((seat, i) => {
          const isMine = seat.id === myPlayerId;
          const takenByOther = seat.claimed && !isMine;
          const canAskStand = isHost && takenByOther && seat.id !== hostPlayerId;

          return (
            <div
              key={seat.id}
              className="flex items-start gap-2 rounded-lg border border-gold/15 bg-ink/30 p-2"
            >
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-gold/20 text-xs text-gold">
                {seat.seat + 1}
              </span>

              <div className="min-w-0 flex-1 space-y-1">
                {editingRoster ? (
                  <Input
                    value={draft[i] ?? ''}
                    onChange={(e) => setSeatName(i, e.target.value)}
                    onBlur={() => commitRename(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    placeholder={t('home.seatPlaceholder', { n: i + 1 })}
                    maxLength={24}
                    autoComplete="off"
                    className="h-9"
                  />
                ) : (
                  <p className="truncate text-sm text-parchment">{seat.name}</p>
                )}
                <p className="flex items-center gap-2 text-xs text-parchment/45">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${latencyDotClass(seat.connected, seat.latency)}`}
                    title={
                      seat.connected
                        ? seat.latency !== undefined
                          ? `${seat.latency} ms`
                          : t('seat.online')
                        : t('seat.offline')
                    }
                  />
                  {seat.claimed ? (
                    <>
                      <span>{seat.connected ? t('seat.online') : t('seat.offline')}</span>
                      {seat.id === hostPlayerId && <span>{t('lobby.host')}</span>}
                      {isMine && <span>{t('common.you')}</span>}
                    </>
                  ) : (
                    <span>{t('seat.empty')}</span>
                  )}
                </p>
              </div>

              <div className="flex h-9 shrink-0 items-center justify-end gap-1">
                {editingRoster ? (
                  seats.length > 5 && (
                    <Button
                      variant="ghost"
                      className="h-9 min-w-16 whitespace-nowrap px-3 text-xs text-crimson"
                      onClick={() => removeSeat(i)}
                    >
                      {t('home.removeSeat')}
                    </Button>
                  )
                ) : isMine ? (
                  <Button variant="secondary" className="h-9 whitespace-nowrap px-3" onClick={onStand}>
                    {t('seat.standUp')}
                  </Button>
                ) : seat.claimed ? (
                  canAskStand && (
                    <Button
                      variant="ghost"
                      className="h-9 whitespace-nowrap px-3 text-crimson"
                      onClick={() => void askStand(seat.id)}
                    >
                      {t('seat.askStandUp')}
                    </Button>
                  )
                ) : (
                  <Button className="h-9 whitespace-nowrap px-3" onClick={() => onClaim(seat.id)}>
                    {t('seat.sitDown')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editingRoster && seats.length < 10 && (
        <Button variant="secondary" className="w-full text-sm" onClick={addSeat}>
          {t('home.addSeat')}
        </Button>
      )}

      {spectators.length > 0 && (
        <div className="border-t border-gold/15 pt-2">
          <p className="text-xs uppercase tracking-wide text-parchment/40">
            {t('lobby.spectators')} ({spectators.length})
          </p>
          <p className="text-sm text-parchment/60">{spectators.map((s) => s.name).join(', ')}</p>
        </div>
      )}

      {error && <p className="text-sm text-crimson">{error}</p>}
    </Card>
  );
}