import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/engine';
import { normalizeSeatHistory, randomSeatOrder, recordSeats } from './seating';

describe('random game seating', () => {
  it.each([5, 6, 7, 8, 9, 10])('moves every returning player at %i seats across 100 seeds', (size) => {
    const players = Object.freeze(Array.from({ length: size }, (_, seat) => ({ id: `p${seat}`, seat })));
    const orders = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const ordered = randomSeatOrder(players, (player) => player.seat, createRng(`seats-${seed}`))!;
      expect(ordered).toHaveLength(size);
      expect(new Set(ordered)).toEqual(new Set(players));
      ordered.forEach((player, seat) => expect(seat).not.toBe(player.seat));
      orders.add(ordered.map((player) => player.id).join(','));
    }
    expect(orders.size).toBeGreaterThan(10);
    expect(players.map((player) => player.seat)).toEqual(Array.from({ length: size }, (_, seat) => seat));
  });

  it('randomizes the first game without an earlier order and is reproducible by seed', () => {
    const players = ['a', 'b', 'c', 'd', 'e'];
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const seed = `first-${i}`;
      const result = randomSeatOrder(players, () => undefined, createRng(seed));
      expect(result).toEqual(randomSeatOrder(players, () => undefined, createRng(seed)));
      orders.add(result!.join(','));
    }
    expect(orders.size).toBeGreaterThan(10);
  });

  it.each([5, 6, 7, 8, 9, 10])('handles changed membership and %i current seats', (size) => {
    const players = Array.from({ length: size }, (_, i) => ({ id: `p${i}`, oldSeat: i % 2 ? undefined : 9 - i }));
    for (let i = 0; i < 100; i++) {
      const ordered = randomSeatOrder(players, (player) => player.oldSeat, createRng(`changed-${i}`))!;
      expect(new Set(ordered)).toEqual(new Set(players));
      ordered.forEach((player, seat) => expect(seat).not.toBe(player.oldSeat));
    }
  });

  it('terminates with an unchanging random source and minimizes unavoidable repeated seats', () => {
    const players = [0, 1, 2, 3, 4];
    const result = randomSeatOrder(players, (player) => player, { next: () => 0 })!;
    result.forEach((player, seat) => expect(seat).not.toBe(player));
    const unavoidable = randomSeatOrder(players, () => 0, { next: () => 0 });
    expect(new Set(unavoidable)).toEqual(new Set(players));
    expect(unavoidable.filter((_, seat) => seat === 0)).toHaveLength(1);
  });

  it('matches an exhaustive optimal assignment for conflicting previous positions', () => {
    function permutations<T>(items: T[]): T[][] {
      return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map((rest) => [item, ...rest])) : [[]];
    }
    const players = [0, 1, 2, 3, 4];
    const all = permutations(players);
    for (let i = 0; i < 100; i++) {
      const rng = createRng(`conflict-${i}`);
      const previous = players.map(() => Math.floor(rng.next() * 7));
      const repeats = (order: number[]) => order.filter((player, seat) => previous[player] === seat).length;
      const optimal = Math.min(...all.map(repeats));
      expect(repeats(randomSeatOrder(players, (player) => previous[player], rng))).toBe(optimal);
    }
  });

  it('randomly chooses who repeats when everybody previously occupied seat one', () => {
    const players = [0, 1, 2, 3, 4];
    const repeated = new Set<number>();
    for (let i = 0; i < 100; i++) repeated.add(randomSeatOrder(players, () => 0, createRng(`all-first-${i}`))[0]!);
    expect(repeated.size).toBe(5);
    expect(randomSeatOrder(players, () => 0, { next: () => NaN })).toHaveLength(5);
  });

  it('ignores malformed history instead of blocking a game', () => {
    expect(normalizeSeatHistory({ byPlayer: null, byAccount: { a: 0, b: -1, c: '1', d: 10 } }))
      .toEqual({ byPlayer: {}, byAccount: { a: 0 } });
    expect(normalizeSeatHistory(null)).toEqual({ byPlayer: {}, byAccount: {} });
  });

  it('records independent account and seat-token identities without retaining mutable player objects', () => {
    const players = [{ id: 'seat-a', seat: 2 }, { id: 'seat-b', seat: 0 }];
    const history = recordSeats(players, { 'seat-a': 'account-a', 'seat-b': 'account-b' });
    players[0]!.seat = 4;
    expect(history).toEqual({
      byPlayer: { 'seat-a': 2, 'seat-b': 0 }, byAccount: { 'account-a': 2, 'account-b': 0 },
    });
  });
});
