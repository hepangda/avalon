import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { RoleCard, nameEms } from '@/components/game/RoleCard';
import {
  PLAYER_COMPOSITION,
  evilSpecialsCount,
  maxEvil,
  previewRoles,
  rejectionLimit,
  speechDuration,
  type GameOptions,
} from '@/lib/engine';
import { useRoleText } from '@/lib/game/useRoleText';
import { cn } from '@/lib/utils/cn';
import { deckEntries, type DeckEntry } from './deck';

const LIMITS = [1, 2, 3, 4, 5];
const SPEECH_PRESETS = [30, 60, 90, 120, 180, 240, 300, 600];

interface GameSetupProps {
  count: number;
  options: GameOptions;
  useRecommended: boolean;
  disabled: boolean;
  onRecommended: (value: boolean) => void;
  /** Morgana and Percival travel together; the page applies that pairing. */
  onChange: (patch: Partial<GameOptions>) => void;
}

function Group({ label, labelId, tone, children }: { label: ReactNode; labelId?: string; tone?: 'good' | 'evil'; children: ReactNode }) {
  return (
    <div className="lobby-group" data-tone={tone}>
      <p id={labelId} className="lobby-group-label">{label}</p>
      {children}
    </div>
  );
}

/** A card the host taps in or out of the game. */
function ToggleCard({ selected, label, title, disabled, onToggle, children }: {
  selected: boolean;
  label: string;
  title?: string;
  disabled: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn('lobby-deck-toggle', !selected && 'is-out')}
      aria-pressed={selected}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onToggle}
    >
      {children}
      <span className="lobby-deck-mark" aria-hidden="true">
        {selected ? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.5 3.2 3.2L15 7" /></svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M10 5v10M5 10h10" /></svg>
        )}
      </span>
    </button>
  );
}

/** One choice from a short scale, tapped directly. */
function Choices({ values, value, labelId, disabled, onPick }: {
  values: number[];
  value: number;
  labelId: string;
  disabled: boolean;
  onPick: (value: number) => void;
}) {
  return (
    <div className="lobby-choices" role="radiogroup" aria-labelledby={labelId}>
      {values.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          disabled={disabled}
          onClick={() => { if (option !== value) onPick(option); }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** The host's whole setup in one place: the deck, the Lady of the Lake, discussion rounds and speaking time. */
export function GameSetup({ count, options, useRecommended, disabled, onRecommended, onChange }: GameSetupProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const id = useId();
  const composition = PLAYER_COMPOSITION[count]!;
  const evilUsed = evilSpecialsCount(options);
  const evilBudget = maxEvil(count);
  const preview = previewRoles(count, options);
  const entries = deckEntries(count, options);
  const morganaPair = options.morgana || options.percival;
  const limit = rejectionLimit(options.maxRejections);
  const speech = speechDuration(options.speechSeconds);
  const lady = Boolean(options.ladyOfTheLake);
  const ladyName = t('phase.LadyOfLake');

  function card(entry: DeckEntry) {
    const art = (
      <span className="lobby-deck-stack" data-count={Math.min(entry.count, 3)}>
        <RoleCard role={entry.role} size="table" />
        {entry.count > 1 && <span className="lobby-deck-count">×{entry.count}</span>}
      </span>
    );
    if (!entry.option) {
      if (!entry.count) return null;
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
        <ToggleCard
          selected={selected}
          label={key === 'morgana' ? `${roleText.name('Morgana')} + ${roleText.name('Percival')}` : roleText.name(entry.role)}
          title={full ? t('lobby.redSeatsFull') : undefined}
          disabled={disabled || full}
          onToggle={() => onChange({ [key]: !selected })}
        >
          {art}
        </ToggleCard>
      </li>
    );
  }

  return (
    <section className="lobby-section" aria-labelledby={`${id}-title`}>
      <div className="lobby-section-head">
        <h2 id={`${id}-title`} className="lobby-section-title">{t('lobby.setupTitle', { count })}</h2>
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
        <Group key={team} tone={team} label={<>{roleText.teamShort(team)}<span className="tabular-nums">{composition[team]}</span></>}>
          <ul className="lobby-deck-row">{entries.filter((entry) => entry.team === team).map(card)}</ul>
        </Group>
      ))}

      <Group label={t('lobby.extras')}>
        <ul className="lobby-deck-row">
          <li className="lobby-deck-card">
            <ToggleCard selected={lady} label={ladyName} disabled={disabled} onToggle={() => onChange({ ladyOfTheLake: !lady })}>
              <span className="lobby-deck-stack">
                <figure className="role-card role-card--table lobby-lady-card">
                  <GameIcon name="lady" className="role-card-art" />
                  <figcaption className="role-card-caption">
                    <p className="role-card-name" style={{ '--name-ems': nameEms(ladyName) } as CSSProperties}>{ladyName}</p>
                  </figcaption>
                </figure>
              </span>
            </ToggleCard>
          </li>
        </ul>
      </Group>

      {evilUsed > evilBudget ? (
        <p role="alert" className="mt-4 text-sm text-crimson-bright">{t('lobby.tooManyEvil', { used: evilUsed, budget: evilBudget })}</p>
      ) : !preview.ok && (
        <p role="alert" className="mt-4 text-sm text-crimson-bright">{preview.error}</p>
      )}

      <Group label={t('lobby.rejectionLimit')} labelId={`${id}-limit`}>
        <Choices values={LIMITS} value={limit} labelId={`${id}-limit`} disabled={disabled} onPick={(value) => onChange({ maxRejections: value })} />
      </Group>

      <Group label={t('lobby.speechSeconds')} labelId={`${id}-speech`}>
        <Choices
          values={[...new Set([...SPEECH_PRESETS, speech])].sort((a, b) => a - b)}
          value={speech}
          labelId={`${id}-speech`}
          disabled={disabled}
          onPick={(value) => onChange({ speechSeconds: value })}
        />
      </Group>
    </section>
  );
}
