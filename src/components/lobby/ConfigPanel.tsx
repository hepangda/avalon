'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import type { GameOptions, Role } from '@/lib/engine';
import {
  PLAYER_COMPOSITION,
  previewRoles,
  recommendedOptions,
  maxEvil,
  evilSpecialsCount,
  missionSizesFor,
  requiredFailsFor,
} from '@/lib/engine';
import { ROLE_SIGIL, ROLE_TEAM_UI, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import type { RoomConfig } from '@/lib/socket/types';

interface ConfigPanelProps {
  config: RoomConfig;
  seatedCount: number;
  isHost: boolean;
  onChange: (config: RoomConfig) => void;
}

type OptionCard = {
  key: keyof GameOptions;
  role?: Role;
  label: string;
  description: string;
  side: 'good' | 'evil' | 'neutral';
};

export function ConfigPanel({ config, seatedCount, isHost, onChange }: ConfigPanelProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const count = Math.max(5, Math.min(10, seatedCount || 5));
  const composition = PLAYER_COMPOSITION[count];

  const preview = useMemo(() => previewRoles(count, config.options), [count, config.options]);
  const evilUsed = evilSpecialsCount(config.options);
  const evilBudget = maxEvil(count);
  const overBudget = evilUsed > evilBudget;

  const optionCards: OptionCard[] = [
    {
      key: 'percival',
      role: 'Percival',
      label: roleText.name('Percival'),
      description: t('lobby.descPercival'),
      side: 'good',
    },
    {
      key: 'morgana',
      role: 'Morgana',
      label: roleText.name('Morgana'),
      description: t('lobby.descMorgana'),
      side: 'evil',
    },
    {
      key: 'mordred',
      role: 'Mordred',
      label: roleText.name('Mordred'),
      description: t('lobby.descMordred'),
      side: 'evil',
    },
    {
      key: 'oberon',
      role: 'Oberon',
      label: roleText.name('Oberon'),
      description: t('lobby.descOberon'),
      side: 'evil',
    },
    {
      key: 'ladyOfTheLake',
      label: t('phase.LadyOfLake'),
      description: t('lobby.descLady'),
      side: 'neutral',
    },
  ];

  const previewRolesList = preview.ok ? sortRoles(preview.roles) : [];
  const missionSizes = missionSizesFor(count);
  const requiredFails = requiredFailsFor(count);

  function setOption<K extends keyof GameOptions>(key: K, value: GameOptions[K]) {
    onChange({ ...config, options: { ...config.options, [key]: value } });
  }

  function applyRecommended() {
    onChange({ ...config, options: recommendedOptions(count) });
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl text-gold">{t('lobby.configuration')}</h2>
        {composition && (
          <span className="text-sm text-parchment/50">
            {t('lobby.goodEvil', { good: composition.good, evil: composition.evil })}
          </span>
        )}
      </div>

      {isHost && (
        <>
          <Button variant="secondary" className="w-full" onClick={applyRecommended}>
            {t('lobby.applyRecommended', { count })}
          </Button>

          <section className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-parchment/50">
              {t('lobby.optionalRoles')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {optionCards.map((card) => (
                <label
                  key={card.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-gold/20 bg-ink/30 px-3 py-2.5 transition-colors hover:border-gold/55"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(config.options[card.key])}
                    onChange={(e) => setOption(card.key, e.target.checked)}
                    className="mt-1 h-4 w-4 accent-gold"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-parchment">{card.label}</span>
                    <span className="block text-xs leading-relaxed text-parchment/50">
                      {card.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="space-y-2 rounded-lg border border-gold/15 bg-ink/30 p-3">
        <p className="text-xs uppercase tracking-wide text-parchment/50">
          {t('lobby.missionPattern')}
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {missionSizes.map((size, i) => {
            const fails = requiredFails[i] ?? 1;
            return (
              <div
                key={i}
                className="rounded-md border border-gold/15 bg-stone/40 px-2 py-2 text-center"
              >
                <p className="text-[10px] uppercase tracking-wide text-parchment/40">
                  {t('lobby.missionNumber', { n: i + 1 })}
                </p>
                <p className="font-serif text-xl text-gold">{size}</p>
                {fails > 1 && (
                  <p className="text-[10px] text-crimson-bright">
                    {t('lobby.failCardsRequired', { count: fails })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="space-y-2 rounded-lg border border-gold/15 bg-ink/30 p-3">
        <p className="text-xs uppercase tracking-wide text-parchment/50">
          {t('lobby.rolesInPlay', { count })}
        </p>
        {overBudget ? (
          <p className="text-sm text-crimson">
            {t('lobby.tooManyEvil', { used: evilUsed, budget: evilBudget })}
          </p>
        ) : preview.ok ? (
          <div className="grid grid-cols-2 justify-items-center gap-3 sm:grid-cols-4">
            {previewRolesList.map((role, i) => (
              <IdentityStyleCard
                key={`${role}-${i}`}
                role={role}
                label={roleText.name(role)}
                description={roleText.blurb(role)}
                side={roleSide(role)}
                selected
                compact
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-crimson">{preview.error}</p>
        )}
      </section>
    </Card>
  );
}

function IdentityStyleCard({
  role,
  label,
  description,
  side,
  selected,
  compact = false,
}: {
  role?: Role;
  label: string;
  description: string;
  side: 'good' | 'evil' | 'neutral';
  selected: boolean;
  compact?: boolean;
}) {
  const t = useTranslations();
  const team = role ? ROLE_TEAM_UI[role] : side === 'neutral' ? null : side;
  const sigil = role ? ROLE_SIGIL[role] : '*';
  const teamLabel = team
    ? role
      ? t(`team.${team}`)
      : t(`team.${team}`)
    : t('lobby.token');
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 text-center shadow-2xl transition',
        compact ? 'h-48 w-32' : 'h-56 w-36',
        team === 'evil'
          ? 'border-crimson/60 bg-gradient-to-b from-crimson/30 to-ink'
          : team === 'good'
            ? 'border-sky-400/50 bg-gradient-to-b from-sky-900/40 to-ink'
            : 'border-gold/50 bg-gradient-to-b from-stone to-ink',
        selected ? 'opacity-100 ring-2 ring-gold/40' : 'opacity-45 grayscale',
      )}
    >
      <span className={compact ? 'text-4xl' : 'text-5xl'}>{sigil}</span>
      <span className={cn('font-serif text-gold', compact ? 'text-base' : 'text-xl')}>
        {label}
      </span>
      <span
        className={cn(
          'text-xs uppercase tracking-wide',
          team ? TEAM_COLOR[team] : 'text-gold',
        )}
      >
        {teamLabel}
      </span>
      {!compact && <p className="mt-1 text-[11px] leading-snug text-parchment/55">{description}</p>}
    </div>
  );
}

function roleSide(role: Role): 'good' | 'evil' {
  return role === 'Merlin' || role === 'Percival' || role === 'LoyalServant' ? 'good' : 'evil';
}

function sortRoles(roles: Role[]): Role[] {
  const order: Role[] = [
    'Merlin',
    'Percival',
    'LoyalServant',
    'Morgana',
    'Mordred',
    'Oberon',
    'Assassin',
    'Minion',
  ];
  return [...roles].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}