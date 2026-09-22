import { useRef, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { GameIcon } from './GameArt';
import { latencyDotClass } from '@/lib/utils/latency';
import {
  arrangeSeats,
  type TablePresentation,
} from '@/lib/game/tablePresentation';
import { MissionTableReveal } from './MissionTableReveal';
import { TableCard } from './TableCard';
import type { ClientPlayer } from '@/lib/engine';

interface GameTableProps {
  players: ClientPlayer[];
  myPlayerId: string | null;
  selectable?: boolean;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  onInspect?: (id: string) => void;
  candidateIds?: string[];
  dimNonCandidates?: boolean;
  highlightIds?: string[];
  board: ReactNode;
  card?: (player: ClientPlayer) => ReactNode;
  hostId?: string | null;
  missionReveal?: Extract<TablePresentation, { kind: 'mission' }> | null;
  onRevealComplete?: (id: string) => void;
}

/** Full-height match table. Numbers straddle the two table edges. */
export function GameTable({
  players,
  myPlayerId,
  selectable = false,
  selectedIds = [],
  onToggle,
  onInspect,
  candidateIds,
  dimNonCandidates = true,
  highlightIds = [],
  board,
  card,
  hostId,
  missionReveal,
  onRevealComplete,
}: GameTableProps) {
  const t = useTranslations();
  const root = useRef<HTMLDivElement>(null);
  const { top, bottom } = arrangeSeats(players, myPlayerId);
  const renderSeat = (p: ClientPlayer) => {
    const candidate = !candidateIds || candidateIds.includes(p.id);
    const canSelect = selectable && candidate && !!onToggle;
    const selected = selectedIds.includes(p.id);
    const isMe = p.id === myPlayerId;
    const connected = p.claimed !== false && p.connected;
    return (
      <div key={p.id} className="table-player">
        <button
          type="button"
          className={cn(
            'table-seat',
            dimNonCandidates && selectable && !candidate && 'is-dimmed',
          )}
          disabled={!canSelect && !onInspect}
          aria-pressed={selectable ? selected : undefined}
          aria-label={`${p.seat + 1}. ${p.name}${isMe ? ` · ${t('common.you')}` : ''}`}
          onClick={() => (canSelect ? onToggle?.(p.id) : onInspect?.(p.id))}
        >
          <span
            className={cn(
              'table-seat-number',
              selected && 'is-selected',
              highlightIds.includes(p.id) && 'is-highlighted',
              p.claimed === false && 'is-empty',
            )}
          >
            {p.seat + 1}
            {p.isLeader && (
              <GameIcon
                name="leader"
                className="table-leader-icon"
                title={t('table.leader')}
              />
            )}
            {p.isLadyHolder && (
              <GameIcon
                name="lady"
                className="table-lady-icon"
                title={t('lady.title')}
              />
            )}
            <span
              className={`table-connection-dot ${latencyDotClass(connected, p.latency)}`}
              title={t(
                p.claimed === false
                  ? 'seat.empty'
                  : connected
                    ? 'seat.online'
                    : 'seat.offline',
              )}
            />
          </span>
          <span
            className={cn(
              'table-seat-name',
              isMe && 'text-gold',
              p.isLeader && 'is-leader',
            )}
          >
            {p.name}
          </span>
          <span className="table-seat-meta">
            {isMe ? t('common.you') : hostId === p.id ? t('lobby.host') : ''}
          </span>
        </button>
        <div
          className="table-personal-zone"
          data-seat-card={p.id}
          style={
            missionReveal?.team.includes(p.id)
              ? { visibility: 'hidden' }
              : undefined
          }
          aria-label={t('table.playerCards', { seat: p.seat + 1 })}
        >
          {card?.(p) ?? <TableCard state="inactive" />}
        </div>
      </div>
    );
  };
  return (
    <div ref={root} className="game-table">
      <div className="table-felt" aria-hidden="true" />
      <div
        className="table-end table-end-top"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, top.length)}, minmax(0, 1fr))`,
        }}
      >
        {top.map(renderSeat)}
      </div>
      <div className="table-center">{board}</div>
      <div
        className="table-end table-end-bottom"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, bottom.length)}, minmax(0, 1fr))`,
        }}
      >
        {bottom.map(renderSeat)}
      </div>
      {missionReveal && onRevealComplete && (
        <MissionTableReveal
          key={missionReveal.id}
          event={missionReveal}
          tableRef={root}
          onComplete={onRevealComplete}
        />
      )}
    </div>
  );
}
