import type { ImgHTMLAttributes } from 'react';
import { assetUrl } from '@/lib/assets';
import type { Role } from '@/lib/engine';
import { roleArt } from '@/lib/game/roleMeta';
import { useCardArtStore } from '@/lib/store/cardArt';
import { cn } from '@/lib/utils/cn';

export type GameIconName =
  'crest' | 'approve' | 'reject' | 'missionSuccess' | 'missionFail' | 'lady' | 'leader' | 'assassinate';

const GAME_ICON_SRC: Record<GameIconName, string> = {
  crest: '/assets/game/icons/crest.webp',
  approve: '/assets/game/icons/approve.webp',
  reject: '/assets/game/icons/reject.webp',
  assassinate: '/assets/game/icons/assassinate.webp',
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
      src={assetUrl(GAME_ICON_SRC[name])}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      className={cn('inline-block shrink-0 select-none object-contain', className)}
      {...props}
    />
  );
}

/** Companion avatar, paired with the same character's full card illustration. */
export function RolePortrait({ role, variant, className, alt = '', ...props }: ArtProps & { role: Role; variant?: number }) {
  const style = useCardArtStore((state) => state.style);
  return (
    <img
      src={roleArt(role, variant, style).avatar}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      className={cn('inline-block shrink-0 select-none object-cover', className)}
      {...props}
    />
  );
}
