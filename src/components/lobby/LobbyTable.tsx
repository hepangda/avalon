import { AnimatePresence } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { SeatMenu } from '@/components/game/SeatMenu';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { useInviteLink } from '@/lib/game/useInviteLink';
import { useSeatHold } from '@/lib/game/useSeatHold';
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
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const { handlers: hold, held } = useSeatHold(true);
  const missing = Math.max(0, 5 - seated.length);
  const avatarOf = (chair: HTMLElement) => chair.querySelector<HTMLElement>('.lobby-chair-avatar') ?? chair;
  const canManage = (member: RoomMember) => isHost && member.id !== myPlayerId && member.id !== hostPlayerId;
  const menuMember = menu && seated.find((m) => m.id === menu.id);

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
    const manage = canManage(member);
    // Bots have no record, so only the host has anything to open on them.
    const hasMenu = !member.isBot || manage;
    const open = (chair: HTMLElement) => setMenu({ id: member.id, anchor: avatarOf(chair) });
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
        {hasMenu ? (
          <button
            type="button"
            className="lobby-chair-seat"
            data-menu
            data-host-menu={manage || undefined}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={menu?.id === member.id}
            {...hold<HTMLButtonElement>(member.id, open)}
            onClick={(event) => {
              if (held(member.id)) return;
              // The host's tap still opens the chair's menu, as before; others right-click or hold.
              if (manage) open(event.currentTarget);
            }}
          >
            {body}
          </button>
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
      <AnimatePresence>
        {menu && menuMember && (
          <SeatMenu key={menuMember.id} code={code} player={menuMember} anchor={menu.anchor} showSeat={false}
            isMe={menuMember.id === myPlayerId} onClose={() => setMenu(null)}
            actions={canManage(menuMember) ? {
              transfer: !menuMember.isBot && menuMember.connected ? {
                busy, error: null, run: () => { setMenu(null); onTransferHost(menuMember.id); },
              } : undefined,
              kick: { busy, run: () => onKick(menuMember.id) },
            } : {}}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
