import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { useInviteLink } from '@/lib/game/useInviteLink';
import { latencyDotClass } from '@/lib/utils/latency';
import { cn } from '@/lib/utils/cn';
import type { RoomMember } from '@/lib/socket/types';

const CHAIRS = 10;
/** Chairs fill clockwise in arrival order (the deal reshuffles seats): along the far side, back along the near side (see CSS). */
const FAR_SIDE = [0, 1, 2, 3, 4];
const NEAR_SIDE = [5, 6, 7, 8, 9];

interface LobbyTableProps {
  code: string;
  seated: RoomMember[];
  hostPlayerId: string | null;
  myPlayerId: string | null;
  isHost: boolean;
  busy: boolean;
  /** Laid face up on the felt under the room code. */
  deck: ReactNode;
  onClaim: () => void;
  onKick: (playerId: string) => void;
  onTransferHost: (playerId: string) => void;
}

/** The table before the deal: ten chairs around the felt, the room code and deck at its heart. */
export function LobbyTable({ code, seated, hostPlayerId, myPlayerId, isHost, busy, deck, onClaim, onKick, onTransferHost }: LobbyTableProps) {
  const t = useTranslations();
  const { copied, copyInvite } = useInviteLink(code, 1500);
  const hasSeat = seated.some((m) => m.id === myPlayerId);
  const [managing, setManaging] = useState<string | null>(null);
  const missing = Math.max(0, 5 - seated.length);

  useEffect(() => {
    if (!managing) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as Element).closest?.('[data-seat-menu]')) {
        setManaging(null);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [managing]);

  function chair(index: number) {
    const member = seated[index];
    if (!member) {
      return (
        <li key={index} className="lobby-chair">
          {index === seated.length && !hasSeat ? (
            <button type="button" className="lobby-chair-seat lobby-chair-open" disabled={busy} onClick={onClaim}>
              <span className="lobby-chair-name">{t('seat.sitDown')}</span>
              <span className="lobby-chair-ring" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <path d="M12 6v12M6 12h12" />
                </svg>
              </span>
            </button>
          ) : (
            <div className="lobby-chair-seat" aria-hidden="true">
              <span className="lobby-chair-name" />
              <span className="lobby-chair-ring" />
            </div>
          )}
        </li>
      );
    }

    const isMine = member.id === myPlayerId;
    const isOwner = member.id === hostPlayerId;
    const canKick = isHost && !isMine && !isOwner;
    const menuOpen = managing === member.id;
    const label = [member.name, isOwner && t('lobby.host'), member.isBot && t('seat.bot'), isMine && t('common.you')]
      .filter(Boolean).join(' · ');
    const status = member.connected
      ? member.latency !== undefined ? `${member.latency} ms` : t('seat.online')
      : t('seat.offline');

    const body = (
      <>
        <span className="lobby-chair-name">
          <span className="truncate">{member.name}</span>
          {member.isBot && (
            <svg viewBox="0 0 24 24" className="lobby-chair-bot" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="7" width="14" height="13" rx="3" />
              <path d="M12 3v4M2 12v4m20-4v4M9 16h6" />
            </svg>
          )}
        </span>
        <PlayerAvatar
          playerId={member.id}
          avatarUrl={member.avatarUrl}
          name={member.name}
          className={cn('lobby-chair-avatar', isMine && 'is-mine', !member.connected && 'is-away')}
        >
          <span className={`player-connection-dot ${latencyDotClass(member.connected, member.latency)}`} title={status} />
          {isOwner && (
            <span className="lobby-chair-host" title={t('lobby.host')}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="m3 6 4 3 3-5 3 5 4-3-2 9H5L3 6Z" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </PlayerAvatar>
      </>
    );

    return (
      <li key={member.id} className="lobby-chair">
        {canKick ? (
          <div className="relative" data-seat-menu>
            <button
              type="button"
              className="lobby-chair-seat"
              aria-label={label}
              aria-expanded={menuOpen}
              onClick={() => setManaging(menuOpen ? null : member.id)}
            >
              {body}
            </button>
            {menuOpen && (
              <div className="lobby-chair-menu">
                {!member.isBot && member.connected && (
                  <button type="button" className="lobby-chair-transfer" disabled={busy}
                    aria-label={`${t('lobby.transferHost')} ${member.name}`}
                    onClick={() => { setManaging(null); onTransferHost(member.id); }}>
                    {t('lobby.transferHost')}
                  </button>
                )}
              <button
                type="button"
                className="lobby-chair-kick"
                disabled={busy}
                aria-label={`${t('seat.askStandUp')} ${member.name}`}
                onClick={() => {
                  setManaging(null);
                  onKick(member.id);
                }}
              >
                {t('seat.askStandUp')}
              </button>
              </div>
            )}
          </div>
        ) : (
          <div className="lobby-chair-seat" role="group" aria-label={label} title={label}>{body}</div>
        )}
      </li>
    );
  }

  return (
    <section className="lobby-table" aria-label={t('seat.sitTitle')}>
      <div className="lobby-felt" aria-hidden="true" />
      <ol className="lobby-side" data-side="far">{FAR_SIDE.map(chair)}</ol>

      <div className="lobby-felt-center">
        <GameIcon name="crest" className="lobby-felt-crest" />
        <div className="lobby-felt-head">
          <p className="lobby-felt-label">{t('lobby.roomCode')}</p>
          <p className="lobby-code room-code" aria-label={`${t('lobby.roomCode')} ${code.split('').join(' ')}`}>{code}</p>
          <button type="button" className="lobby-invite" onClick={() => void copyInvite()} aria-live="polite">
            {copied ? (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m4.5 10.5 3.5 3.5 7.5-8" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
              </svg>
            )}
            {copied ? t('lobby.copied') : t('lobby.inviteLink')}
          </button>
          <p className="lobby-felt-status">
            <span className="tabular-nums">{seated.length} / {CHAIRS}</span>
            <span aria-hidden="true">·</span>
            {missing > 0 ? t('lobby.moreNeeded', { count: missing }) : t('lobby.readyToBegin')}
          </p>
        </div>
        <div className="lobby-felt-deck">{deck}</div>
      </div>

      <ol className="lobby-side" data-side="near">{NEAR_SIDE.map(chair)}</ol>
    </section>
  );
}
