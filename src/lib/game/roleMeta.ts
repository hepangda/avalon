import type { Role, Team } from '@/lib/engine';

/**
 * Non-text role presentation data. Display names and blurbs live in the i18n
 * message files (roles.*); use useRoleText() to read them. Here we keep only
 * locale-independent data: team and paired card / avatar assets.
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

const ROLE_ART_SLUG: Record<Role, string> = {
  Merlin: 'merlin',
  Percival: 'percival',
  LoyalServant: 'loyal-servant-1',
  Morgana: 'morgana',
  Assassin: 'assassin',
  Oberon: 'oberon',
  Mordred: 'mordred',
  Minion: 'minion',
};

export function roleArt(role: Role, variant = 0) {
  const index = Number.isInteger(variant) && variant >= 0 ? variant % 4 : 0;
  const slug = role === 'LoyalServant' ? `loyal-servant-${index + 1}` : ROLE_ART_SLUG[role];
  return {
    card: `/assets/game/roles/cards/${slug}.webp`,
    avatar: `/assets/game/roles/avatars/${slug}.webp`,
  };
}

export const TEAM_COLOR: Record<Team, string> = {
  good: 'text-sky-300',
  evil: 'text-crimson',
};
