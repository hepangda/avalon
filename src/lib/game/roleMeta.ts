import type { Role, Team } from '@/lib/engine';

/**
 * Non-text role presentation data. Display names and blurbs live in the i18n
 * message files (roles.*); use useRoleText() to read them. Here we keep only
 * locale-independent data: team and a sigil emoji crest.
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

export const ROLE_SIGIL: Record<Role, string> = {
  Merlin: '🔮',
  Percival: '🛡️',
  LoyalServant: '⚜️',
  Morgana: '🌙',
  Assassin: '🗡️',
  Oberon: '👁️',
  Mordred: '👑',
  Minion: '⚔️',
};

export const TEAM_COLOR: Record<Team, string> = {
  good: 'text-sky-300',
  evil: 'text-crimson',
};
