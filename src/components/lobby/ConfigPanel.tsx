'use client';

import { useId, useMemo } from 'react';
import { useTranslations } from 'use-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RoleCard } from '@/components/game/RoleCard';
import type { GameOptions, Role } from '@/lib/engine';
import {
  PLAYER_COMPOSITION,
  previewRoles,
  recommendedOptions,
  maxEvil,
  evilSpecialsCount,
  missionSizesFor,
  requiredFailsFor,
  rejectionLimit,
} from '@/lib/engine';
import { useRoleText } from '@/lib/game/useRoleText';
import type { RoomConfig } from '@/lib/socket/types';

interface ConfigPanelProps {
  config: RoomConfig;
  seatedCount: number;
  isHost: boolean;
  onChange: (config: RoomConfig) => void;
}

type RoleOption = {
  key: 'morgana' | 'oberon' | 'mordred' | 'ladyOfTheLake';
  label: string;
};

export function ConfigPanel({
  config,
  seatedCount,
  isHost,
  onChange,
}: ConfigPanelProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const optionsId = useId();
  const count = Math.max(5, Math.min(10, seatedCount || 5));
  const composition = PLAYER_COMPOSITION[count];

  const preview = useMemo(
    () => previewRoles(count, config.options),
    [count, config.options],
  );
  const evilUsed = evilSpecialsCount(config.options);
  const evilBudget = maxEvil(count);
  const overBudget = evilUsed > evilBudget;

  const roleOptions: RoleOption[] = [
    {
      key: 'morgana',
      label: `${roleText.name('Morgana')} + ${roleText.name('Percival')}`,
    },
    {
      key: 'oberon',
      label: roleText.name('Oberon'),
    },
    {
      key: 'mordred',
      label: roleText.name('Mordred'),
    },
    {
      key: 'ladyOfTheLake',
      label: t('phase.LadyOfLake'),
    },
  ];
  const maxRejections = rejectionLimit(config.options.maxRejections);

  const previewRolesList = preview.ok ? sortRoles(preview.roles) : [];
  const missionSizes = missionSizesFor(count);
  const requiredFails = requiredFailsFor(count);

  function setOption<K extends keyof GameOptions>(
    key: K,
    value: GameOptions[K],
  ) {
    const options = { ...config.options, [key]: value };
    if (key === 'morgana') {
      options.percival = Boolean(value);
    }
    onChange({ ...config, options });
  }

  function applyRecommended() {
    onChange({
      ...config,
      options: { ...recommendedOptions(count), maxRejections },
    });
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl text-gold">
          {t('lobby.configuration')}
        </h2>
        {composition && (
          <span className="text-sm text-parchment/50">
            {t('lobby.goodEvil', {
              good: composition.good,
              evil: composition.evil,
            })}
          </span>
        )}
      </div>

      {isHost && (
        <>
          <Button
            variant="secondary"
            className="w-full"
            onClick={applyRecommended}
          >
            {t('lobby.applyRecommended', { count })}
          </Button>

          <section className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-parchment/50">
              {t('lobby.optionalRoles')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {roleOptions.map((option) => {
                const checked = option.key === 'morgana'
                  ? config.options.morgana || config.options.percival
                  : config.options[option.key];
                const inputId = `${optionsId}-${option.key}`;
                return (
                  <label
                    key={option.key}
                    htmlFor={inputId}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-gold/20 bg-ink/30 px-3 py-3 transition-colors hover:border-gold/55"
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium text-parchment">
                      {option.label}
                    </span>
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setOption(option.key, e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-gold"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        </>
      )}

      <section className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-gold/20 bg-ink/30 px-3 py-1.5">
        <p id={`${optionsId}-discussion-limit`} className="text-sm font-medium text-parchment">
          {t('lobby.rejectionLimit')}
        </p>
        <div
          role="group"
          aria-labelledby={`${optionsId}-discussion-limit`}
          className="flex h-8 shrink-0 items-center rounded-md border border-gold/30 bg-ink"
        >
          <Button
            type="button"
            variant="ghost"
            className="h-full w-9 p-0 text-base leading-none"
            disabled={!isHost || maxRejections <= 1}
            onClick={() => setOption('maxRejections', maxRejections - 1)}
            aria-label={t('lobby.decreaseDiscussionLimit')}
          >
            −
          </Button>
          <output
            aria-live="polite"
            aria-labelledby={`${optionsId}-discussion-limit`}
            className="flex h-full w-8 items-center justify-center text-sm leading-none tabular-nums text-parchment"
          >
            {maxRejections}
          </output>
          <Button
            type="button"
            variant="ghost"
            className="h-full w-9 p-0 text-base leading-none"
            disabled={!isHost || maxRejections >= 5}
            onClick={() => setOption('maxRejections', maxRejections + 1)}
            aria-label={t('lobby.increaseDiscussionLimit')}
          >
            ＋
          </Button>
        </div>
      </section>

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
              <RoleCard
                key={`${role}-${i}`}
                role={role}
                variant={
                  previewRolesList.slice(0, i).filter((item) => item === role)
                    .length
                }
                size="compact"
                className="w-full"
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
