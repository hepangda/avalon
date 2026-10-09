import { useTranslations } from 'use-intl';
import { RoleCard } from '@/components/game/RoleCard';
import { PLAYER_COMPOSITION, evilSpecialsCount, maxEvil, previewRoles, type GameOptions } from '@/lib/engine';
import { useRoleText } from '@/lib/game/useRoleText';
import { cn } from '@/lib/utils/cn';
import { deckEntries, type DeckEntry, type DeckOption } from './deck';

interface RoleDeckProps {
  count: number;
  options: GameOptions;
  useRecommended: boolean;
  disabled: boolean;
  onRecommended: (value: boolean) => void;
  onToggle: (key: DeckOption, value: boolean) => void;
}

/** The host's deck editor: the cards this table will be dealt, optional ones tapped in or out. */
export function RoleDeck({ count, options, useRecommended, disabled, onRecommended, onToggle }: RoleDeckProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const composition = PLAYER_COMPOSITION[count]!;
  const evilUsed = evilSpecialsCount(options);
  const evilBudget = maxEvil(count);
  const preview = previewRoles(count, options);
  const entries = deckEntries(count, options);
  const morganaPair = options.morgana || options.percival;

  function card(entry: DeckEntry) {
    const inPlay = entry.count > 0;
    if (!inPlay && !entry.option) return null;
    const art = (
      <span className="lobby-deck-stack" data-count={Math.min(entry.count, 3)}>
        <RoleCard role={entry.role} size="table" />
        {entry.count > 1 && <span className="lobby-deck-count">×{entry.count}</span>}
      </span>
    );
    if (!entry.option) {
      return (
        <li key={entry.role} className="lobby-deck-card" aria-label={`${roleText.name(entry.role)}${entry.count > 1 ? ` ×${entry.count}` : ''}`}>
          {art}
        </li>
      );
    }
    const key = entry.option;
    const selected = key === 'morgana' ? morganaPair : options[key];
    // Adding a red specialist needs a free red seat; removing one never does.
    const full = !selected && evilUsed >= evilBudget;
    return (
      <li key={entry.role} className="lobby-deck-card">
        <button
          type="button"
          className={cn('lobby-deck-toggle', !inPlay && 'is-out')}
          aria-pressed={selected}
          aria-label={key === 'morgana' ? `${roleText.name('Morgana')} + ${roleText.name('Percival')}` : roleText.name(entry.role)}
          title={full ? t('lobby.redSeatsFull') : undefined}
          disabled={disabled || full}
          onClick={() => onToggle(key, !selected)}
        >
          {art}
          <span className="lobby-deck-mark" aria-hidden="true">
            {selected ? (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.5 3.2 3.2L15 7" /></svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M10 5v10M5 10h10" /></svg>
            )}
          </span>
        </button>
      </li>
    );
  }

  return (
    <section className="lobby-section" aria-labelledby="lobby-deck-title">
      <div className="lobby-section-head">
        <h2 id="lobby-deck-title" className="lobby-section-title">{t('lobby.rolesInPlay', { count })}</h2>
        <label className="lobby-switch">
          <span>{t('lobby.recommended')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={useRecommended}
            disabled={disabled}
            onChange={(event) => onRecommended(event.target.checked)}
          />
        </label>
      </div>

      {(['good', 'evil'] as const).map((team) => (
        <div key={team} className="lobby-deck-team" data-team={team}>
          <p className="lobby-deck-team-label">
            {roleText.teamShort(team)}
            <span className="tabular-nums">{composition[team]}</span>
          </p>
          <ul className="lobby-deck-row">{entries.filter((entry) => entry.team === team).map(card)}</ul>
        </div>
      ))}

      {evilUsed > evilBudget ? (
        <p role="alert" className="mt-3 text-sm text-crimson-bright">{t('lobby.tooManyEvil', { used: evilUsed, budget: evilBudget })}</p>
      ) : !preview.ok && (
        <p role="alert" className="mt-3 text-sm text-crimson-bright">{preview.error}</p>
      )}
    </section>
  );
}

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
      aria-label={t('lobby.rolesInPlay', { count })}
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
