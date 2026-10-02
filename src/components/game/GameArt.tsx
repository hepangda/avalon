import type { ImgHTMLAttributes } from 'react';
import { assetUrl } from '@/lib/assets';
import type { Role } from '@/lib/engine';
import { roleArt } from '@/lib/game/roleMeta';
import { useCardArtStore } from '@/lib/store/cardArt';
import { cn } from '@/lib/utils/cn';

import { GAME_ICON_SRC, type GameIconName } from '@/lib/game/gameIcons';
export type { GameIconName } from '@/lib/game/gameIcons';

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
