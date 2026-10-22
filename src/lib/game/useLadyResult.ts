import { useCallback, useState } from 'react';
import type { ClientGameState } from '@/lib/engine';

type LadyResult = NonNullable<ClientGameState['privateLadyResult']>;

/**
 * The engine keeps projecting the holder's last inspection for the rest of the game,
 * so whether it has been seen lives in the tab: a refresh or a reconnect must not replay it.
 */
export function ladySeenKey(game: Pick<ClientGameState, 'gameId'>, playerId: string | null, targetId: string) {
  return game.gameId && playerId ? `avalon:lady-seen:${game.gameId}:${playerId}:${targetId}` : null;
}

function stored(key: string | null) {
  if (!key) return false;
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

/** The inspection result this viewer has not dismissed yet; never once the game is over. */
export function useLadyResult(game: ClientGameState | null, playerId: string | null) {
  // Tables without a game id (the gallery) still remember it for as long as they are mounted.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const result = game?.privateLadyResult;
  const key = game && result ? ladySeenKey(game, playerId, result.targetId) : null;
  const memo = result ? `${game?.gameId}:${playerId}:${result.targetId}` : null;
  const unseen: LadyResult | null =
    result && game?.phase !== 'GameOver' && dismissed !== memo && !stored(key) ? result : null;
  const markSeen = useCallback(() => {
    setDismissed(memo);
    if (key) try { sessionStorage.setItem(key, '1'); } catch { /* it shows again after a refresh */ }
  }, [key, memo]);
  return { unseen, markSeen };
}
