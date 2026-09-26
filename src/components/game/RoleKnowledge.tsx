import { useTranslations } from 'use-intl';
import type { ClientGameState, VisibilityInfo } from '@/lib/engine';
import { labelById } from '@/lib/game/playerLabel';
import { cn } from '@/lib/utils/cn';
import { useRoleText } from '@/lib/game/useRoleText';

/** One concise line per kind of information visible to this player. */
export function RoleKnowledge({
  game,
  knownPlayers,
  className,
}: {
  game: Pick<ClientGameState, 'players'>;
  knownPlayers: VisibilityInfo[];
  className?: string;
}) {
  const t = useTranslations('roleReveal');
  const roleText = useRoleText();
  if (knownPlayers.length === 0) return null;

  const groups = new Map<VisibilityInfo['shownAs'], string[]>();
  for (const known of knownPlayers) {
    const names = groups.get(known.shownAs) ?? [];
    const label = labelById(game, known.playerId);
    names.push(known.shownAs === 'known-ally' && known.role ? `${label} · ${roleText.name(known.role)}` : label);
    groups.set(known.shownAs, names);
  }
  const labels = {
    evil: t('shownEvil'),
    'merlin-or-morgana': t('shownMerlinOrMorgana'),
    'known-ally': t('shownAlly'),
  };

  return (
    <dl className={cn('role-knowledge', className)}>
      {[...groups].map(([kind, names]) => (
        <div key={kind} className="role-knowledge-row">
          <dt className="role-knowledge-label">
            {t('perceptionLabel', { kind: labels[kind] })}
          </dt>
          <dd className="role-knowledge-players">
            {names.map((name) => (
              <span key={name} className="role-knowledge-player">{name}</span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
