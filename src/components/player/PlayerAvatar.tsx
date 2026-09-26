import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { playerAvatarUrl } from '@/lib/game/playerAvatar';

interface PlayerAvatarProps {
  playerId: string;
  avatarUrl?: string;
  name: string;
  empty?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Profile picture first, then a stable portrait from the shared player-ID pool. */
export function PlayerAvatar({ playerId, avatarUrl, name, empty = false, className, children }: PlayerAvatarProps) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const fallbackUrl = useMemo(() => playerAvatarUrl(playerId), [playerId]);

  useEffect(() => setFailedUrls([]), [avatarUrl, playerId, empty]);

  const imageUrl = empty ? undefined : [avatarUrl, fallbackUrl]
    .find((url): url is string => !!url && !failedUrls.includes(url));
  return (
    <span
      className={cn(
        'relative flex items-center justify-center overflow-visible rounded-full bg-gold/20 text-gold',
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailedUrls((urls) => urls.includes(imageUrl) ? urls : [...urls, imageUrl])}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
        />
      ) : (
        <svg viewBox="0 0 24 24" className="h-3/5 w-3/5 opacity-50" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2Z" />
        </svg>
      )}
      {children}
    </span>
  );
}
