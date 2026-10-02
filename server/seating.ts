import type { RNG } from '@/lib/engine';

/** Private history of the most recently started game in this room. */
export interface SeatHistory {
  byPlayer: Record<string, number>;
  byAccount: Record<string, number>;
}

export function normalizeSeatHistory(raw: unknown): SeatHistory {
  const history = raw && typeof raw === 'object' ? raw as Partial<SeatHistory> : {};
  const seats = (value: unknown): Record<string, number> => Object.fromEntries(
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).filter(([, seat]) => Number.isInteger(seat) && seat >= 0 && seat < 10)
      : [],
  );
  return { byPlayer: seats(history.byPlayer), byAccount: seats(history.byAccount) };
}

export function recordSeats(
  players: readonly { id: string; seat: number }[],
  accounts: Readonly<Record<string, string>>,
): SeatHistory {
  return {
    byPlayer: Object.fromEntries(players.map((player) => [player.id, player.seat])),
    byAccount: Object.fromEntries(players.flatMap((player) => {
      const account = accounts[player.id];
      return account ? [[account, player.seat]] : [];
    })),
  };
}

/** Minimize repeated seats, then choose uniformly among the optimal orders. */
export function randomSeatOrder<T>(
  players: readonly T[],
  previousSeat: (player: T) => number | undefined,
  rng: Pick<RNG, 'next'>,
): T[] {
  // Preferences must never reject a deal. The room separately enforces 5–10 players.
  const fallback = () => {
    const order = [...players];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(draw() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order;
  };
  function draw() {
    const value = rng.next();
    return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0;
  }
  if (players.length > 10) return fallback();
  const previous = players.map(previousSeat);
  const full = (1 << players.length) - 1;
  const memo = new Map<number, { repeats: number; ways: number }>();

  function best(used: number, seat: number): { repeats: number; ways: number } {
    if (used === full) return { repeats: 0, ways: 1 };
    const cached = memo.get(used);
    if (cached) return cached;
    let repeats = Infinity;
    let ways = 0;
    for (let i = 0; i < players.length; i++) {
      if (used & (1 << i)) continue;
      const rest = best(used | (1 << i), seat + 1);
      const cost = Number(previous[i] === seat) + rest.repeats;
      if (cost < repeats) { repeats = cost; ways = rest.ways; }
      else if (cost === repeats) ways += rest.ways;
    }
    const result = { repeats, ways };
    memo.set(used, result);
    return result;
  }

  const ordered: T[] = [];
  let used = 0;
  for (let seat = 0; seat < players.length; seat++) {
    const optimal = best(used, seat);
    let ticket = Math.floor(draw() * optimal.ways);
    for (let i = 0; i < players.length; i++) {
      if (used & (1 << i)) continue;
      const rest = best(used | (1 << i), seat + 1);
      if (Number(previous[i] === seat) + rest.repeats !== optimal.repeats) continue;
      if (ticket < rest.ways) {
        ordered.push(players[i]!);
        used |= 1 << i;
        break;
      }
      ticket -= rest.ways;
    }
  }
  return ordered.length === players.length ? ordered : fallback();
}
