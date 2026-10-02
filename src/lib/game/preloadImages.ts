import { assetUrl } from '@/lib/assets';
import { CARD_ART_STYLES, type CardArtStyle } from '@/lib/preferences';
import { CARD_DECKS } from './cardDecks';
import { GAME_ICON_SRC } from './gameIcons';
import { PLAYER_AVATAR_POOL } from './playerAvatar';
import { ROLE_TEAM_UI, roleArt } from './roleMeta';

/** Load common art and the selected deck first, then every alternate deck. */
export function gameImageUrls(style: CardArtStyle): string[] {
  const urls = [
    ...Object.values(GAME_ICON_SRC).map(assetUrl),
    ...PLAYER_AVATAR_POOL.map(assetUrl),
  ];
  for (const deck of [style, ...CARD_ART_STYLES.filter((other) => other !== style)]) {
    for (const role of Object.keys(ROLE_TEAM_UI) as Array<keyof typeof ROLE_TEAM_UI>) {
      const count = CARD_DECKS[deck].variants[role]?.length ?? 1;
      for (let variant = 0; variant < count; variant++) {
        const art = roleArt(role, variant, deck);
        urls.push(art.card, art.avatar);
      }
    }
  }
  return [...new Set(urls)];
}

/** Shared across room navigation; retain loaded Images as well as browser caching. */
export function createImagePreloader() {
  const loaded = new Map<string, HTMLImageElement>();
  const pending = new Set<string>();
  const queue: Array<{ url: string; attempt: number }> = [];
  let active = 0;

  function pump() {
    while (active < 4 && queue.length) {
      const { url, attempt } = queue.shift()!;
      const image = new Image();
      active++;
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        active--;
        if (success) {
          loaded.set(url, image);
          pending.delete(url);
        } else if (attempt < 2) {
          // Retry after the remaining images, so one broken URL cannot block them.
          queue.push({ url, attempt: attempt + 1 });
        } else {
          // A later room entry or online event can try failed images again.
          pending.delete(url);
        }
        pump();
      };
      const timeout = setTimeout(() => {
        image.removeAttribute('src');
        finish(false);
      }, 30_000);
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.decoding = 'async';
      image.fetchPriority = 'low';
      image.src = url;
    }
  }

  return (urls: readonly string[]) => {
    if (typeof Image === 'undefined') return;
    for (const url of urls) {
      if (loaded.has(url) || pending.has(url)) continue;
      pending.add(url);
      queue.push({ url, attempt: 1 });
    }
    pump();
  };
}

export const preloadImages = createImagePreloader();
