import type { CSSProperties } from 'react';
import type { Role } from '@/lib/engine';
import { roleArt, ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { useCardArtStore } from '@/lib/store/cardArt';
import { cn } from '@/lib/utils/cn';
import type { CardArtStyle } from '@/lib/preferences';

/** Rough width of the longest unbreakable run, in em: CJK glyphs are square, Latin about half. */
function nameEms(name: string) {
  return Math.max(...name.split(/\s+/).map((word) =>
    [...word].reduce((sum, ch) => sum + (/[\u2E80-\uFFEF]/.test(ch) ? 1 : 0.5), 0)));
}

/** Full illustration with localized text on a translucent, team-colored fade. */
export function RoleCard({
  role,
  variant,
  size = 'full',
  style: styleOverride,
  className,
}: {
  role: Role;
  variant?: number;
  size?: 'full' | 'compact' | 'table';
  style?: CardArtStyle;
  className?: string;
}) {
  const text = useRoleText();
  const selectedStyle = useCardArtStore((state) => state.style);
  const style = styleOverride ?? selectedStyle;
  const team = ROLE_TEAM_UI[role];
  const name = size === 'full' ? text.name(role) : text.shortName(role);
  const description = size === 'full' ? text.blurb(role) : '';
  return (
    <figure className={cn('role-card', `role-card--${size}`, className)} data-team={team} data-style={style}>
      <img
        src={roleArt(role, variant, style).card}
        alt=""
        aria-hidden="true"
        width={1024}
        height={1536}
        draggable={false}
        className="role-card-art"
      />
      <figcaption className="role-card-caption">
        {size !== 'table' && <p className="role-card-team">{text.teamLabel(team)}</p>}
        <p
          className="role-card-name"
          style={size === 'table' ? ({ '--name-ems': nameEms(name) } as CSSProperties) : undefined}
        >
          {name}
        </p>
        {description && <p className="role-card-description">{description}</p>}
      </figcaption>
    </figure>
  );
}
