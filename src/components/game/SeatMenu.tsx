import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { teamOf, type ClientPlayer } from '@/lib/engine';
import type { RoomMember } from '@/lib/socket/types';
import type { SeatRecord, TeamRecord } from '@/lib/game/historyTypes';
import { useRoleText } from '@/lib/game/useRoleText';
import { useSeatRecord } from '@/lib/game/useSeatRecord';
import { GameIcon, RolePortrait } from './GameArt';

const percent = ({ games, wins }: TeamRecord) => (games ? Math.round((wins / games) * 100) : 0);
const GAP = 10;

export interface SeatMenuActions {
  onMarkRole?: () => void;
  onEmote?: () => void;
  transfer?: { busy: boolean; error: string | null; run: () => void };
  kick?: { busy: boolean; run: () => void };
}

/** A seat at the dealt table, or a chair in the lobby before the deal. */
type SeatPlayer = Pick<ClientPlayer | RoomMember, 'id' | 'name' | 'seat' | 'avatarUrl' | 'claimed' | 'isBot'>;

/**
 * The plate a seat opens on right-click or a long press: who sits there, their
 * record unfolded on demand, and what the viewer may do to that seat.
 */
export function SeatMenu({ code, player, anchor, isMe, actions, onClose, showSeat = true }: {
  code: string;
  player: SeatPlayer;
  /** The seat's portrait; the plate grows out of it and folds back into it. */
  anchor: HTMLElement;
  isMe: boolean;
  actions: SeatMenuActions;
  onClose: () => void;
  /** Lobby chairs have no seat numbers until the deal. */
  showSeat?: boolean;
}) {
  const t = useTranslations();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ style: CSSProperties; origin: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const hasRecord = !player.isBot && player.claimed !== false;
  const { record, failed, retry } = useSeatRecord(code, player.id, hasRecord);

  useLayoutEffect(() => {
    function position() {
      const plate = ref.current;
      if (!plate) return;
      const rect = anchor.getBoundingClientRect();
      const width = plate.offsetWidth;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const above = rect.top > viewportHeight - rect.bottom;
      const room = (above ? rect.top : viewportHeight - rect.bottom) - GAP - 8;
      const center = rect.left + rect.width / 2;
      const left = Math.max(8, Math.min(center - width / 2, viewportWidth - width - 8));
      const reach = GAP + rect.height / 2;
      setPlace({
        // Grows away from its seat, so unfolding the record never covers the portrait.
        style: above
          ? { left, bottom: viewportHeight - rect.top + GAP, maxHeight: room }
          : { left, top: rect.bottom + GAP, maxHeight: room },
        origin: `${center - left}px ${above ? `calc(100% + ${reach}px)` : `${-reach}px`}`,
      });
    }
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const seat = anchor.closest('button');
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      seat?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  const then = (act: () => void) => () => { onClose(); act(); };
  const items: ReactNode[] = [];
  // A record its owner keeps private stays sealed: the row says so and does not unfold.
  const sealed = !!record?.hidden;
  if (hasRecord) items.push(
    <button key="record" type="button" role="menuitem" className="seat-menu-item" data-sealed={sealed || undefined}
      aria-expanded={sealed ? undefined : open} aria-disabled={sealed || undefined}
      onClick={() => { if (!sealed) setOpen((value) => !value); }}>
      <GameIcon name="crest" className="seat-menu-art" />
      <span>{t('seatMenu.record')}</span>
      {sealed ? (
        <span className="seat-menu-sealed">
          <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>
          {t('seatMenu.private')}
        </span>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="seat-menu-chevron"><path d="m4 6 4 4 4-4" /></svg>
      )}
    </button>,
    <AnimatePresence key="record-fold" initial={false}>
      {open && !sealed && (
        <motion.div className="seat-menu-fold"
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.3, 0.7, 0.3, 1] }}>
          <SeatDossier record={record} failed={failed} onRetry={retry} />
        </motion.div>
      )}
    </AnimatePresence>,
  );
  if (actions.onMarkRole) items.push(
    <button key="mark" type="button" role="menuitem" className="seat-menu-item" onClick={then(actions.onMarkRole)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="seat-menu-glyph">
        <path d="M3.5 10.2V4.5a1 1 0 0 1 1-1h5.7l6.3 6.3a1 1 0 0 1 0 1.4l-5.3 5.3a1 1 0 0 1-1.4 0Z" /><circle cx="7.2" cy="7.2" r="1.3" />
      </svg>
      <span>{t('seatMenu.markRole')}</span>
    </button>,
  );
  if (actions.onEmote) items.push(
    <button key="emote" type="button" role="menuitem" className="seat-menu-item" onClick={then(actions.onEmote)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="seat-menu-glyph">
        <circle cx="10" cy="10" r="7" /><path d="M7 11.8c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5" /><path d="M7.4 7.9h.01M12.6 7.9h.01" strokeWidth="2.2" />
      </svg>
      <span>{t('seatMenu.emotes')}</span>
    </button>,
  );
  if (actions.transfer) {
    const { busy, error, run } = actions.transfer;
    items.push(
      <button key="host" type="button" role="menuitem" className="seat-menu-item" data-confirm={confirming || undefined}
        disabled={busy} onClick={() => confirming ? run() : setConfirming(true)}>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="seat-menu-glyph">
          <circle cx="6.5" cy="10" r="3" /><path d="M9.5 10h8M14.5 10v3M17 10v2.2" />
        </svg>
        <span>{t(confirming ? 'seatMenu.confirmTransfer' : 'seatMenu.transferHost')}</span>
      </button>,
      error && <p key="host-error" role="alert" className="seat-menu-alert">{error}</p>,
    );
  }
  if (actions.kick) items.push(
    <button key="kick" type="button" role="menuitem" className="seat-menu-item" data-tone="danger"
      disabled={actions.kick.busy} onClick={then(actions.kick.run)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="seat-menu-glyph">
        <path d="M8 4.5H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M12 6.5 15.5 10 12 13.5M15.5 10H8" />
      </svg>
      <span>{t('seat.askStandUp')}</span>
    </button>,
  );

  const rating = record?.rating;
  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      aria-label={showSeat ? t('seatMenu.label', { seat: player.seat + 1, name: player.name }) : player.name}
      className="seat-menu"
      style={{ ...place?.style, transformOrigin: place?.origin, visibility: place ? undefined : 'hidden' }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.2 }}
      animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 34 } }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.2, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:enabled') ?? [])];
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
          : (at + (event.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
        list[next]?.focus();
      }}
    >
      <header className="seat-menu-plate">
        <PlayerAvatar playerId={player.id} avatarUrl={player.claimed === false ? undefined : player.avatarUrl}
          name={player.name} empty={player.claimed === false} className="seat-menu-avatar">
          {showSeat && <span className="seat-menu-seat" aria-hidden="true">{player.seat + 1}</span>}
        </PlayerAvatar>
        <div className="seat-menu-who">
          <p className="seat-menu-name">
            <span className="truncate">{player.name}</span>
            {isMe && <small>{t('common.you')}</small>}
          </p>
          <p className="seat-menu-title">
            {player.isBot ? t('seatMenu.bot')
              : rating ? t(`history.titles.${rating.title}`)
                : record === null ? t('seatMenu.noRecord') : ' '}
          </p>
        </div>
        {hasRecord && (
          <div className="seat-menu-medal" title={t('history.scoreHelp')} data-title={rating?.title} aria-label={rating ? `${t('seatMenu.score')} ${rating.score.toFixed(1)}` : undefined}>
            <GameIcon name="crest" className="seat-menu-medal-crest" />
            <strong className="tabular-nums">{rating ? rating.score.toFixed(1) : record === null ? '—' : ''}</strong>
          </div>
        )}
      </header>
      {items.length > 0 && <div className="seat-menu-items">{items}</div>}
    </motion.div>,
    document.body,
  );
}

function SeatDossier({ record, failed, onRetry }: { record?: SeatRecord | null; failed: boolean; onRetry: () => void }) {
  const t = useTranslations();
  const roleText = useRoleText();
  if (failed) return (
    <p role="alert" className="seat-menu-note">
      {t('history.loadFailed')}
      <button type="button" onClick={onRetry}>{t('history.retry')}</button>
    </p>
  );
  if (record === undefined) return <div className="seat-menu-dossier is-loading" aria-busy="true" aria-label={t('history.loading')}><i /><i /><i /></div>;
  if (!record || record.hidden || record.total.games === 0) return <p className="seat-menu-note">{t('history.empty')}</p>;
  return (
    <div className="seat-menu-dossier">
      <dl className="seat-menu-stats">
        <div><dt>{t('history.games')}</dt><dd className="tabular-nums">{record.total.games}</dd></div>
        <div><dt>{t('history.wins')}</dt><dd className="tabular-nums">{record.total.wins}</dd></div>
        <div><dt>{t('history.winRate')}</dt><dd className="tabular-nums">{percent(record.total)}<small>%</small></dd></div>
      </dl>
      <div className="seat-menu-sides">
        {(['good', 'evil'] as const).map((team) => {
          const side = record.teams[team];
          return (
            <div key={team} className="seat-menu-side" data-team={team} style={{ '--rate': `${percent(side)}%` } as CSSProperties}
              aria-label={t('history.sideRecord', { team: roleText.teamShort(team), wins: side.wins, games: side.games })}>
              <span className="seat-menu-side-name" aria-hidden="true">{roleText.teamShort(team)}</span>
              <span className="seat-menu-side-count tabular-nums" aria-hidden="true">{side.wins}<i>/</i>{side.games}</span>
            </div>
          );
        })}
      </div>
      {record.roles.length > 0 && (
        <ol className="seat-menu-roles" aria-label={t('history.roles')}>
          {record.roles.map(({ role, games, wins }) => (
            <li key={role} data-team={teamOf(role)} aria-label={`${roleText.shortName(role)} ${t('history.winsOf', { wins, games })}`}>
              <RolePortrait role={role} className="seat-menu-role-art" />
              <span className="seat-menu-role-name" aria-hidden="true">{roleText.shortName(role)}</span>
              <span className="seat-menu-role-count tabular-nums" aria-hidden="true">{wins}/{games}</span>
            </li>
          ))}
        </ol>
      )}
      {record.form.length > 0 && (
        <ol className="seat-menu-form" aria-label={t('history.form')}>
          {record.form.map((won, i) => (
            <li key={i} data-won={won} title={t(won ? 'history.win' : 'history.loss')}>
              <span className="sr-only">{t(won ? 'history.win' : 'history.loss')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
