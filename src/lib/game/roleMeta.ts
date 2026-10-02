import type { Role, Team } from '@/lib/engine';
import { assetUrl } from '@/lib/assets';
import { DEFAULT_CARD_ART_STYLE, type CardArtStyle } from '@/lib/preferences';
import { CARD_DECKS } from './cardDecks';
export { CARD_ART_STYLES, isCardArtStyle, type CardArtStyle } from '@/lib/preferences';

/**
 * Non-text role presentation data. Display names and blurbs live in the i18n
 * message files (roles.*); use useRoleText() to read them. Here we keep only
 * locale-independent data: team and paired card / avatar assets.
 */
export { ROLE_TEAM as ROLE_TEAM_UI } from '@/lib/engine/roles';

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

export function roleArt(role: Role, variant = 0, style: CardArtStyle = DEFAULT_CARD_ART_STYLE) {
  const index = Number.isInteger(variant) && variant >= 0 ? variant : 0;
  const variants = CARD_DECKS[style].variants[role];
  const slug = variants?.[index % variants.length] ?? ROLE_ART_SLUG[role];
  const root = `/assets/game/roles/${style}`;
  return {
    card: assetUrl(`${root}/cards/${slug}.webp`),
    avatar: assetUrl(`${root}/avatars/${slug}.webp`),
  };
}

export const TEAM_COLOR: Record<Team, string> = {
  good: 'text-sky-300',
  evil: 'text-crimson',
};
