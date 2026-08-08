import type { ImgHTMLAttributes } from 'react';
import type { Role } from '@/lib/engine';
import { ROLE_PORTRAIT } from '@/lib/game/roleMeta';
import { cn } from '@/lib/utils/cn';

export type GameIconName =
  'crest' | 'approve' | 'reject' | 'missionSuccess' | 'missionFail' | 'lady' | 'leader';

const GAME_ICON_SRC: Record<GameIconName, string> = {
  crest: '/assets/game/icons/crest.webp',
  approve: '/assets/game/icons/approve.webp',
  reject: '/assets/game/icons/reject.webp',
  missionSuccess: '/assets/game/icons/mission-success.webp',
  missionFail: '/assets/game/icons/mission-fail.webp',
  lady: '/assets/game/icons/lady.webp',
  leader: '/assets/game/icons/leader.webp',
};

type ArtProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>;

/** Generated gameplay emblem with transparent edges and consistent sizing. */
export function GameIcon({
  name,
  className,
  alt = '',
  ...props
}: ArtProps & { name: GameIconName }) {
  return (
    <img
      src={GAME_ICON_SRC[name]}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      className={cn('inline-block shrink-0 select-none object-contain', className)}
      {...props}
    />
  );
}

/** Generated role medallion. Role names remain live localized text beside it. */
export function RolePortrait({ role, className, alt = '', ...props }: ArtProps & { role: Role }) {
  return (
    <img
      src={ROLE_PORTRAIT[role]}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      className={cn('inline-block shrink-0 select-none object-cover', className)}
      {...props}
    />
  );
}
