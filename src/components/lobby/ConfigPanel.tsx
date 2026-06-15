'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import type { GameOptions, Role } from '@/lib/engine';
import {
  PLAYER_COMPOSITION,
  previewRoles,
  recommendedOptions,
  maxEvil,
  evilSpecialsCount,
} from '@/lib/engine';
import { useRoleText } from '@/lib/game/useRoleText';
import type { RoomConfig } from '@/lib/socket/types';

interface ConfigPanelProps {
  config: RoomConfig;
  seatedCount: number;
  isHost: boolean;
  onChange: (config: RoomConfig) => void;
}

export function ConfigPanel({ config, seatedCount, isHost, onChange }: ConfigPanelProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const count = Math.max(5, Math.min(10, seatedCount || 5));
  const composition = PLAYER_COMPOSITION[count];

  const preview = useMemo(() => previewRoles(count, config.options), [count, config.options]);
  const evilUsed = evilSpecialsCount(config.options);
  const evilBudget = maxEvil(count);
  const overBudget = evilUsed > evilBudget;

  function setOption<K extends keyof GameOptions>(key: K, value: GameOptions[K]) {
    onChange({ ...config, options: { ...config.options, [key]: value } });
  }

  function applyRecommended() {
    onChange({ ...config, options: recommendedOptions(count) });
  }

  function setPolicy<K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) {
    onChange({ ...config, [key]: value });
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
        <Button variant="secondary" className="w-full" onClick={applyRecommended}>
          {t('lobby.applyRecommended', { count })}
        </Button>
      )}

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-parchment/50">
          {t('lobby.optionalRoles')}
        </p>
        <Toggle
          label={roleText.name('Percival')}
          description={t('lobby.descPercival')}
          checked={config.options.percival}
          onChange={(v) => setOption('percival', v)}
          disabled={!isHost}
        />
        <Toggle
          label={roleText.name('Morgana')}
          description={t('lobby.descMorgana')}
          checked={config.options.morgana}
          onChange={(v) => setOption('morgana', v)}
          disabled={!isHost}
        />
        <Toggle
          label={roleText.name('Mordred')}
          description={t('lobby.descMordred')}
          checked={config.options.mordred}
          onChange={(v) => setOption('mordred', v)}
          disabled={!isHost}
        />
        <Toggle
          label={roleText.name('Oberon')}
          description={t('lobby.descOberon')}
          checked={config.options.oberon}
          onChange={(v) => setOption('oberon', v)}
          disabled={!isHost}
        />
        <Toggle
          label={t('phase.LadyOfLake')}
          description={t('lobby.descLady')}
          checked={config.options.ladyOfTheLake}
          onChange={(v) => setOption('ladyOfTheLake', v)}
          disabled={!isHost}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-parchment/50">{t('lobby.roomPolicy')}</p>
        <Toggle
          label={t('lobby.allowSpectators')}
          checked={config.allowSpectators}
          onChange={(v) => setPolicy('allowSpectators', v)}
          disabled={!isHost}
        />
        <Toggle
          label={t('lobby.allowMidJoin')}
          checked={config.allowMidJoin}
          onChange={(v) => setPolicy('allowMidJoin', v)}
          disabled={!isHost}
        />
      </div>

      <div className="rounded-lg border border-gold/15 bg-ink/30 p-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-parchment/50">
          {t('lobby.rolesInPlay', { count })}
        </p>
        {overBudget ? (
          <p className="text-sm text-crimson">
            {t('lobby.tooManyEvil', { used: evilUsed, budget: evilBudget })}
          </p>
        ) : preview.ok ? (
          <p className="text-sm text-parchment/80">
            {countRoles(preview.roles)
              .map(([role, n]) => (n > 1 ? `${roleText.name(role)} ×${n}` : roleText.name(role)))
              .join(' · ')}
          </p>
        ) : (
          <p className="text-sm text-crimson">{preview.error}</p>
        )}
      </div>
    </Card>
  );
}

function countRoles(roles: Role[]): Array<[Role, number]> {
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
  const counts = new Map<Role, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return order.filter((r) => counts.has(r)).map((r) => [r, counts.get(r)!]);
}
