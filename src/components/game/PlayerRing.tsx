'use client';

import { cn } from '@/lib/utils/cn';
import { latencyDotClass } from '@/lib/utils/latency';
import type { ClientGameState, ClientPlayer } from '@/lib/engine';
import { useTranslations } from 'next-intl';

interface PlayerRingProps {
  game: ClientGameState;
  myPlayerId: string | null;
  /** Players currently selectable (for team building / targeting). */
  selectable?: boolean;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  /** Restrict selectable set (e.g. assassin candidates). */
  candidateIds?: string[];
  /** Highlight the proposed team. */
  highlightIds?: string[];
}

export function PlayerRing({
  game,
  myPlayerId,
  selectable = false,
  selectedIds = [],
  onToggle,
  candidateIds,
  highlightIds = [],
}: PlayerRingProps) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {game.players.map((p) => (
        <PlayerChip
          key={p.id}
          player={p}
          isMe={p.id === myPlayerId}
          selectable={selectable && (!candidateIds || candidateIds.includes(p.id))}
          selected={selectedIds.includes(p.id)}
          highlighted={highlightIds.includes(p.id)}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function PlayerChip({
  player,
  isMe,
  selectable,
  selected,
  highlighted,
  onToggle,
}: {
  player: ClientPlayer;
  isMe: boolean;
  selectable: boolean;
  selected: boolean;
  highlighted: boolean;
  onToggle?: (id: string) => void;
}) {
  const clickable = selectable && !!onToggle;
  const t = useTranslations();

  return (
    <li>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && onToggle?.(player.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
          selected
            ? 'border-gold bg-gold/20'
            : highlighted
              ? 'border-sky-400/60 bg-sky-500/10'
              : 'border-gold/15 bg-ink/30',
          clickable ? 'cursor-pointer hover:border-gold/60' : 'cursor-default',
          !player.connected && 'opacity-60',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/20 text-xs text-gold">
          {player.seat + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-parchment">{player.name}</span>
        {isMe && <span className="text-[10px] text-parchment/40">({t('common.you')})</span>}
        {player.isLeader && <span title="Leader">👑</span>}
        {player.isLadyHolder && <span title="Lady of the Lake">🌊</span>}
        <span
          title={
            player.connected
              ? player.latency !== undefined
                ? `${player.latency} ms`
                : 'Online'
              : 'Offline'
          }
          className={cn('inline-block h-1.5 w-1.5 rounded-full', latencyDotClass(player.connected, player.latency))}
        />
      </button>
    </li>
  );
}
