import type { RNG } from './types';

/**
 * Deterministic seeded RNG. The engine never calls Math.random(); all
 * randomness flows through a seed so games are reproducible for replay.
 */

/** Hash an arbitrary string seed into a 32-bit integer (xmur3). */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 PRNG: fast, deterministic, good enough for shuffling. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): RNG {
  const seedFn = xmur3(seed);
  const next = mulberry32(seedFn());
  return {
    next,
    shuffle<T>(xs: readonly T[]): T[] {
      const arr = [...xs];
      // Fisher–Yates using the seeded stream.
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = arr[i]!;
        const b = arr[j]!;
        arr[i] = b;
        arr[j] = a;
      }
      return arr;
    },
  };
}
