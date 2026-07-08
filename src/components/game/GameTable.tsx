'use client';

import { Fragment, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { latencyDotClass } from '@/lib/utils/latency';
import type { ClientGameState, ClientPlayer } from '@/lib/engine';

interface GameTableProps {
  game: ClientGameState;
  myPlayerId: string | null;
  /** Tap-to-select surface (team building / targeting). */
  selectable?: boolean;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  /** Restrict the selectable set (e.g. assassin / lady candidates). */
  candidateIds?: string[];
  /** Highlight a set of seats (e.g. the proposed mission team). */
  highlightIds?: string[];
  /** The centre board — game progress (mission track, phase, proposal). */
  board?: ReactNode;
  /** Optional badge rendered under each seat (e.g. a vote chip). */
  seatBadge?: (player: ClientPlayer) => ReactNode;
  /** The viewer's own cards (identity + dealt action cards), laid on the felt
   *  in front of their seat. */
  playZone?: ReactNode;
}

/**
 * The table, drawn as one rounded "felt" surface: players seated along the top
 * and bottom edges, a central board showing game progress, and the viewer's own
 * cards laid on the felt in front of them. Doubles as a tap-to-select surface;
 * selection/candidate/highlight semantics match the old grid so every caller
 * keeps working.
 */
export function GameTable({
  game,
  myPlayerId,
  selectable = false,
  selectedIds = [],
  onToggle,
  candidateIds,
  highlightIds = [],
  board,
  seatBadge,
  playZone,
}: GameTableProps) {
  const { top, bottom } = arrangeSeats(game.players, myPlayerId);

  const renderSeat = (p: ClientPlayer) => (
    <Seat
      key={p.id}
      player={p}
      isMe={p.id === myPlayerId}
      clickable={selectable && (!candidateIds || candidateIds.includes(p.id)) && !!onToggle}
      selected={selectedIds.includes(p.id)}
      highlighted={highlightIds.includes(p.id)}
      dimmed={!!candidateIds && !candidateIds.includes(p.id) && selectable}
      badge={seatBadge?.(p)}
      onToggle={onToggle}
    />
  );

  return (
    <div className="relative space-y-3 rounded-[1.75rem] border-2 border-gold/30 bg-gradient-to-b from-stone/45 to-ink/70 p-3 shadow-[inset_0_2px_34px_rgba(0,0,0,0.55)] sm:p-4">
      {/* Faint gilt inner frame for a table-felt feel. */}
      <div className="pointer-events-none absolute inset-2 rounded-[1.4rem] border border-gold/10" />

      {top.length > 0 && (
        <div className="relative flex items-end justify-center gap-2 sm:gap-3">
          {top.map(renderSeat)}
        </div>
      )}

      {/* Centre display: the shared play area / progress board. */}
      <div className="relative rounded-xl border border-gold/15 bg-ink/40 px-3 py-2.5">
        {board}
      </div>

      <div className="relative flex items-start justify-center gap-2 sm:gap-3">
        {bottom.map((p) => (
          <Fragment key={p.id}>{renderSeat(p)}</Fragment>
        ))}
      </div>

      {/* The viewer's cards, laid on the felt in front of their seat. */}
      {playZone && <div className="relative border-t border-gold/15 pt-2.5">{playZone}</div>}
    </div>
  );
}

/**
 * Split the players into a top and bottom row, anchoring the viewer to the
 * centre of the bottom row and walking the seat order around the table so the
 * two rows read as one continuous loop.
 */
function arrangeSeats(
  players: ClientPlayer[],
  myPlayerId: string | null,
): { top: ClientPlayer[]; bottom: ClientPlayer[] } {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const n = ordered.length;
  if (n === 0) return { top: [], bottom: [] };

  const viewerPos = ordered.findIndex((p) => p.id === myPlayerId);
  const anchor = viewerPos >= 0 ? viewerPos : 0;
  const bottomCount = Math.ceil(n / 2);
  const leftOfYou = Math.floor((bottomCount - 1) / 2);
  const start = (anchor - leftOfYou + n) % n;

  const loop = Array.from({ length: n }, (_, i) => ordered[(start + i) % n]!);
  return {
    bottom: loop.slice(0, bottomCount),
    // Reverse the far row so the loop stays continuous left-to-right.
    top: loop.slice(bottomCount).reverse(),
  };
}

function Seat({
  player,
  isMe,
  clickable,
  selected,
  highlighted,
  dimmed,
  badge,
  onToggle,
}: {
  player: ClientPlayer;
  isMe: boolean;
  clickable: boolean;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  badge?: ReactNode;
  onToggle?: (id: string) => void;
}) {
  const t = useTranslations();
  const reduce = useReducedMotion();

  const ringClass = selected
    ? 'border-gold bg-gold/25 shadow-candle'
    : highlighted
      ? 'border-sky-400/70 bg-sky-500/15'
      : 'border-gold/25 bg-ink/50';

  return (
    <motion.button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onToggle?.(player.id)}
      initial={false}
      animate={{ scale: selected ? 1.08 : 1 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 22 }}
      className={cn(
        'flex w-14 flex-col items-center gap-0.5',
        clickable ? 'cursor-pointer' : 'cursor-default',
        dimmed && 'opacity-35',
        !player.connected && 'opacity-60',
      )}
      title={player.name}
    >
      <span
        className={cn(
          'relative flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
          ringClass,
          clickable && !selected && 'hover:border-gold/70',
        )}
      >
        {player.isLeader && (
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-gold/70"
            animate={reduce ? undefined : { opacity: [0.7, 0.15, 0.7], scale: [1, 1.18, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <span className="relative text-gold">{player.seat + 1}</span>

        {player.isLeader && (
          <span className="absolute -right-1 -top-2 text-sm" title="Leader">
            👑
          </span>
        )}
        {player.isLadyHolder && (
          <span className="absolute -left-1 -top-2 text-sm" title="Lady of the Lake">
            🌊
          </span>
        )}
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 inline-block h-2 w-2 rounded-full ring-2 ring-ink',
            latencyDotClass(player.connected, player.latency),
          )}
        />
      </span>

      <span
        className={cn(
          'max-w-full truncate text-[11px] leading-tight',
          isMe ? 'text-gold' : 'text-parchment/80',
        )}
      >
        {player.name}
      </span>
      {isMe && <span className="text-[9px] leading-none text-parchment/40">({t('common.you')})</span>}

      {badge && <span className="mt-0.5">{badge}</span>}
    </motion.button>
  );
}
