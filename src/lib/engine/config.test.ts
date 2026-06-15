import { describe, it, expect } from 'vitest';
import {
  PLAYER_COMPOSITION,
  MISSION_TEAM_SIZE,
  REQUIRED_FAILS,
  missionSize,
  requiredFails,
} from './config';

describe('player-count config tables', () => {
  it('composition matches official splits', () => {
    expect(PLAYER_COMPOSITION[5]).toEqual({ good: 3, evil: 2 });
    expect(PLAYER_COMPOSITION[6]).toEqual({ good: 4, evil: 2 });
    expect(PLAYER_COMPOSITION[7]).toEqual({ good: 4, evil: 3 });
    expect(PLAYER_COMPOSITION[8]).toEqual({ good: 5, evil: 3 });
    expect(PLAYER_COMPOSITION[9]).toEqual({ good: 6, evil: 3 });
    expect(PLAYER_COMPOSITION[10]).toEqual({ good: 6, evil: 4 });
  });

  it('good + evil sums to player count', () => {
    for (let n = 5; n <= 10; n++) {
      const c = PLAYER_COMPOSITION[n]!;
      expect(c.good + c.evil).toBe(n);
    }
  });

  it('mission team sizes match the board', () => {
    expect(MISSION_TEAM_SIZE[5]).toEqual([2, 3, 2, 3, 3]);
    expect(MISSION_TEAM_SIZE[6]).toEqual([2, 3, 4, 3, 4]);
    expect(MISSION_TEAM_SIZE[7]).toEqual([2, 3, 3, 4, 4]);
    expect(MISSION_TEAM_SIZE[8]).toEqual([3, 4, 4, 5, 5]);
    expect(MISSION_TEAM_SIZE[9]).toEqual([3, 4, 4, 5, 5]);
    expect(MISSION_TEAM_SIZE[10]).toEqual([3, 4, 4, 5, 5]);
  });

  it('every count has exactly 5 mission sizes', () => {
    for (let n = 5; n <= 10; n++) {
      expect(MISSION_TEAM_SIZE[n]).toHaveLength(5);
    }
  });

  it('required-fails: only mission 4 for 7+ players needs 2', () => {
    expect(REQUIRED_FAILS[5]).toEqual([1, 1, 1, 1, 1]);
    expect(REQUIRED_FAILS[6]).toEqual([1, 1, 1, 1, 1]);
    expect(REQUIRED_FAILS[7]).toEqual([1, 1, 1, 2, 1]);
    expect(REQUIRED_FAILS[8]).toEqual([1, 1, 1, 2, 1]);
    expect(REQUIRED_FAILS[9]).toEqual([1, 1, 1, 2, 1]);
    expect(REQUIRED_FAILS[10]).toEqual([1, 1, 1, 2, 1]);
  });

  it('exactly four cells equal 2, all at mission index 3', () => {
    let twoCount = 0;
    for (let n = 5; n <= 10; n++) {
      REQUIRED_FAILS[n]!.forEach((v, idx) => {
        if (v === 2) {
          twoCount++;
          expect(idx).toBe(3);
        }
      });
    }
    expect(twoCount).toBe(4);
  });

  it('helper accessors agree with tables', () => {
    expect(missionSize(7, 3)).toBe(4);
    expect(requiredFails(7, 3)).toBe(2);
    expect(requiredFails(5, 0)).toBe(1);
  });
});
