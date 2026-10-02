import avatarIds from './player-avatars.json';
import { assetUrl } from '@/lib/assets';
import { createRng } from '@/lib/engine/rng';

/** Add a portrait file and its ID to player-avatars.json to extend this pool. */
export const PLAYER_AVATAR_POOL = Object.freeze(
  avatarIds.map((id) => `/assets/game/player-avatars/${id}.webp`),
);

/** Rendezvous hashing avoids reshuffling existing portraits when the pool grows. */
export function playerAvatarUrl(playerId: string, pool: readonly string[] = PLAYER_AVATAR_POOL): string {
  let selected = pool[0];
  if (!selected) throw new Error('Player avatar pool must not be empty');
  let bestScore = -1;
  for (const avatar of pool) {
    const avatarId = avatar.slice(avatar.lastIndexOf('/') + 1).replace(/\.webp$/, '');
    const score = createRng(JSON.stringify(['player-avatar:v1', playerId, avatarId])).next();
    if (score > bestScore || (score === bestScore && avatar < selected)) {
      bestScore = score;
      selected = avatar;
    }
  }
  // Choose using original IDs so changing the CDN or image contents never reshuffles avatars.
  return assetUrl(selected);
}
