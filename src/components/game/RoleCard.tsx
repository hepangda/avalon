import type { Role } from '@/lib/engine';
import { roleArt, ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { useCardArtStore } from '@/lib/store/cardArt';
import { cn } from '@/lib/utils/cn';

/** Full illustration with localized text on a translucent, team-colored fade. */
export function RoleCard({
  role,
  variant,
  size = 'full',
  className,
}: {
  role: Role;
  variant?: number;
  size?: 'full' | 'compact' | 'table';
  className?: string;
}) {
  const text = useRoleText();
  const style = useCardArtStore((state) => state.style);
  const team = ROLE_TEAM_UI[role];
  const description = size === 'full' ? text.blurb(role) : '';
  return (
    <figure className={cn('role-card', `role-card--${size}`, className)} data-team={team}>
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
        <p className="role-card-name">{size === 'full' ? text.name(role) : text.shortName(role)}</p>
        {description && <p className="role-card-description">{description}</p>}
      </figcaption>
    </figure>
  );
}
