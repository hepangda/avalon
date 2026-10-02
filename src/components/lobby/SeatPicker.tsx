import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { latencyDotClass } from '@/lib/utils/latency';
import { cn } from '@/lib/utils/cn';
import type { Ack, RoomMember } from '@/lib/socket/types';

interface SeatPickerProps {
  members: RoomMember[];
  hostPlayerId: string | null;
  myPlayerId: string | null;
  isHost: boolean;
  disabled?: boolean;
  onClaim: () => Promise<void>;
  onStand: () => Promise<void>;
  onAddBot: () => Promise<Ack>;
  onKick: (seatId: string) => Promise<Ack>;
}

export function SeatPicker({
  members, hostPlayerId, myPlayerId, isHost, disabled = false, onClaim, onStand, onKick, onAddBot,
}: SeatPickerProps) {
  const t = useTranslations();
  const seated = members.filter((m) => !m.isSpectator && m.claimed).sort((a, b) => a.seat - b.seat);
  const [pending, setPending] = useState(false);
  const actionPending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const hasSeat = seated.some((member) => member.id === myPlayerId);
  const busy = disabled || pending;

  async function act(action: () => Promise<void | Ack>) {
    if (disabled || actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result && !result.ok) setError(result.error?.message ?? t('table.actionFailed'));
    } catch {
      setError(t('table.actionFailed'));
    } finally {
      actionPending.current = false;
      setPending(false);
    }
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5" aria-busy={pending}>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-gold">{t('seat.sitTitle')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-parchment/50" aria-label={t('lobby.seated', { count: seated.length })}>
            {seated.length} / 10
          </span>
          {isHost && seated.length < 10 && (
            <Button variant="secondary" className="h-9 px-3 text-xs" disabled={busy} onClick={() => void act(onAddBot)}>
              {t('seat.addBot')}
            </Button>
          )}
          {hasSeat && (
            <Button variant="secondary" className="h-9 px-3 text-xs" disabled={busy} onClick={() => void act(onStand)}>
              {t('seat.standUp')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 sm:gap-3">
        {seated.map((member) => {
          const isMine = member.id === myPlayerId;
          const isOwner = member.id === hostPlayerId;
          return (
            <div
              key={member.id}
              className={cn(
                'relative flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border px-2 py-4 sm:py-5',
                isMine ? 'border-gold/50 bg-gold/5' : 'border-gold/15 bg-ink/30',
              )}
              title={[member.name, isOwner && t('lobby.host'), isMine && t('common.you')].filter(Boolean).join(' · ')}
            >
              <PlayerAvatar
                playerId={member.id}
                avatarUrl={member.avatarUrl}
                name={member.name}
                className="h-14 w-14 shrink-0 border border-gold/25 sm:h-16 sm:w-16"
              >
                <span
                  className={`player-connection-dot ${latencyDotClass(member.connected, member.latency)}`}
                  title={member.connected ? member.latency !== undefined ? `${member.latency} ms` : t('seat.online') : t('seat.offline')}
                />
                {isOwner && (
                  <span className="absolute -bottom-1 -left-1 grid h-5 w-5 place-items-center rounded-full border border-gold/40 bg-ink text-gold" title={t('lobby.host')}>
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="m3 6 4 3 3-5 3 5 4-3-2 9H5L3 6Z" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </PlayerAvatar>
              <p className="flex w-full min-w-0 items-center justify-center gap-1 text-sm font-medium text-parchment">
                <span className="truncate">{member.name}</span>
                {member.isBot && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gold/60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={t('seat.bot')}>
                    <title>{t('seat.bot')}</title>
                    <rect x="5" y="7" width="14" height="13" rx="3" />
                    <path d="M12 3v4M2 12v4m20-4v4M9 16h6" />
                    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
                    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
                  </svg>
                )}
              </p>
              {isHost && !isMine && !isOwner && (
                <button
                  type="button"
                  className="absolute right-0.5 top-0.5 grid h-8 w-8 place-items-center rounded-full text-parchment/35 transition-colors hover:bg-crimson/15 hover:text-crimson-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:opacity-40"
                  aria-label={`${t('seat.askStandUp')} ${member.name}`}
                  title={t('seat.askStandUp')}
                  disabled={busy}
                  onClick={() => void act(() => onKick(member.id))}
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="m6 6 8 8M14 6l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        {seated.length < 10 && (
          <button
            type="button"
            className="group flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gold/30 bg-ink/15 px-2 py-4 text-gold/75 transition-colors enabled:hover:border-gold/70 enabled:hover:bg-gold/5 enabled:hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:cursor-default disabled:opacity-40 sm:py-5"
            disabled={busy || hasSeat}
            onClick={() => void act(onClaim)}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-current sm:h-16 sm:w-16" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-sm font-medium">{t('seat.sitDown')}</span>
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    </Card>
  );
}
