'use client';

import { useTranslations } from 'next-intl';
import type { Role, Team } from '@/lib/engine';

/**
 * Locale-aware accessors for role display text. Pairs with the non-text data
 * in roleMeta.ts (ROLE_SIGIL, ROLE_TEAM_UI, TEAM_COLOR).
 */
export function useRoleText() {
  const t = useTranslations();
  return {
    name: (role: Role) => t(`roles.${role}.name`),
    blurb: (role: Role) => t(`roles.${role}.blurb`),
    teamLabel: (team: Team) => (team === 'evil' ? t('team.evilLabel') : t('team.goodLabel')),
    teamShort: (team: Team) => (team === 'evil' ? t('team.evil') : t('team.good')),
  };
}
