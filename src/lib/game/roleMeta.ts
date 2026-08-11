import type { Role, Team } from '@/lib/engine';

/**
 * Non-text role presentation data. Display names and blurbs live in the i18n
 * message files (roles.*); use useRoleText() to read them. Here we keep only
 * locale-independent data: team and generated portrait asset.
 */
export const ROLE_TEAM_UI: Record<Role, Team> = {
  Merlin: 'good',
  Percival: 'good',
  LoyalServant: 'good',
  Morgana: 'evil',
  Assassin: 'evil',
  Oberon: 'evil',
  Mordred: 'evil',
  Minion: 'evil',
};

export const ROLE_PORTRAIT: Record<Role, string> = {
  Merlin: '/assets/game/roles/merlin.webp',
  Percival: '/assets/game/roles/percival-v3.webp',
  LoyalServant: '/assets/game/roles/loyal-servant.webp',
  Morgana: '/assets/game/roles/morgana.webp',
  Assassin: '/assets/game/roles/assassin.webp',
  Oberon: '/assets/game/roles/oberon.webp',
  Mordred: '/assets/game/roles/mordred.webp',
  Minion: '/assets/game/roles/minion.webp',
};

export const TEAM_COLOR: Record<Team, string> = {
  good: 'text-sky-300',
  evil: 'text-crimson',
};
