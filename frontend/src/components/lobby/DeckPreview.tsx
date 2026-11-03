import { useTranslations } from 'use-intl';
import { RoleCard } from '@/components/game/RoleCard';
import type { GameOptions } from '@/lib/engine';
import { deckEntries } from './deck';

/** The dealt deck, face up on the felt. For the host it opens the setup where there is no side panel. */
export function DeckPreview({ count, options, onOpen }: { count: number; options: GameOptions; onOpen?: () => void }) {
  const t = useTranslations();
  const entries = deckEntries(count, options).filter((entry) => entry.count > 0);
  const Root = onOpen ? 'button' : 'div';
  return (
    <Root
      type={onOpen ? 'button' : undefined}
      role={onOpen ? undefined : 'group'}
      className="lobby-preview"
      aria-label={t('lobby.setupTitle', { count })}
      onClick={onOpen}
    >
      {(['good', 'evil'] as const).map((team) => (
        <span key={team} className="lobby-preview-team">
          {entries.filter((entry) => entry.team === team).map((entry) => (
            <span key={entry.role} className="lobby-preview-card lobby-deck-stack" data-count={Math.min(entry.count, 3)}>
              <RoleCard role={entry.role} size="table" />
              {entry.count > 1 && <span className="lobby-deck-count">×{entry.count}</span>}
            </span>
          ))}
        </span>
      ))}
    </Root>
  );
}
