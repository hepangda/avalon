export interface RerollCards {
  cards: number;
  completedGames: number;
  lastDailyDay: string | null;
}

/** UTC+8 at 04:00 is UTC at 20:00 on the previous calendar date. */
export function rewardDay(now: number): string {
  return new Date(now + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function emptyCards(): RerollCards {
  return { cards: 0, completedGames: 0, lastDailyDay: null };
}

export function claimDaily(wallet: RerollCards, now: number): RerollCards {
  const day = rewardDay(now);
  if (wallet.lastDailyDay !== null && wallet.lastDailyDay >= day) return wallet;
  return { ...wallet, cards: Math.min(2, wallet.cards + 1), lastDailyDay: day };
}

export function completeGame(wallet: RerollCards): RerollCards {
  const completedGames = wallet.completedGames + 1;
  return { ...wallet, completedGames, cards: Math.min(2, wallet.cards + (completedGames % 5 === 0 ? 1 : 0)) };
}
