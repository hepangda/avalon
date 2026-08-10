import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface PlayerAvatarProps {
  avatarUrl?: string;
  name: string;
  seat: number;
  className?: string;
  children?: ReactNode;
}

/** OAuth avatar with the seat number retained as a compact table-reference badge. */
export function PlayerAvatar({ avatarUrl, name, seat, className, children }: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [avatarUrl]);

  const showImage = Boolean(avatarUrl && !failed);
  return (
    <span
      className={cn(
        'relative flex items-center justify-center overflow-visible rounded-full bg-gold/20 text-gold',
        className,
      )}
    >
      <span className="relative">{seat + 1}</span>
      {showImage && (
        <>
          <img
            src={avatarUrl}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full rounded-full object-cover"
          />
          <span className="absolute -bottom-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-gold/50 bg-ink px-0.5 text-[9px] leading-none text-gold">
            {seat + 1}
          </span>
        </>
      )}
      {children}
    </span>
  );
}
