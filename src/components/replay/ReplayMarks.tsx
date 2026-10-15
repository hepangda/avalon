import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { RolePortrait } from '@/components/game/GameArt';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ReplaySeat } from '@/lib/game/replayModel';
import { cn } from '@/lib/utils/cn';

/** Revealed role portrait ringed in its team colour; falls back to the player's own avatar. */
export function SeatPortrait({ player, className }: { player: ReplaySeat; className?: string }) {
  return (
    <span className={cn('replay-portrait', className)} data-team={player.team}>
      {player.role ? (
        <RolePortrait role={player.role} variant={player.variant} className="h-full w-full rounded-full" />
      ) : (
        <PlayerAvatar playerId={player.id} avatarUrl={player.avatarUrl} name={player.name} className="h-full w-full" />
      )}
    </span>
  );
}

/** Seat number disc in the player's team colour. */
export function SeatNumber({ player, className }: { player: ReplaySeat; className?: string }) {
  return (
    <span className={cn('replay-seat', className)} data-team={player.team} title={seatLabel(player.seat, player.name)}>
      {player.seat + 1}
    </span>
  );
}

export function SeatChip({
  player,
  onSelect,
  muted = false,
}: {
  player: ReplaySeat;
  onSelect?: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn('replay-chip', muted && 'is-muted')}
      data-team={player.team}
      onClick={() => onSelect?.(player.id)}
    >
      <SeatPortrait player={player} className="replay-chip-portrait" />
      <span className="truncate">{seatLabel(player.seat, player.name)}</span>
    </button>
  );
}
