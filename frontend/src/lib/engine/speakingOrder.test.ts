import { describe, expect, it } from 'vitest';
import { applyEvent, createGame } from '@/lib/debug/rustEngine';
import { DEFAULT_OPTIONS } from '@/lib/debug/testkit';
import { speakingOrder } from './speakingOrder';

describe('speaking order', () => {
  const players = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, seat: i }));

  it('opens with the seat on either side of the leader', () => {
    expect(speakingOrder(players, 'p5', 'clockwise', 5)[0]).toBe('p4');
    expect(speakingOrder(players, 'p5', 'counterclockwise', 5)[0]).toBe('p6');
  });

  it('wraps around the table and lets the leader speak last', () => {
    expect(speakingOrder(players, 'p0', 'clockwise', 5)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2', 'p1', 'p0']);
    expect(speakingOrder(players, 'p6', 'counterclockwise', 5)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('matches the order the engine starts', () => {
    let dealt = applyEvent(createGame({
      hostId: 'p0', seed: 'discussion', options: DEFAULT_OPTIONS,
      players: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    }), { type: 'START_GAME', by: 'p0', flowVersion: 5 });
    for (const p of dealt.players) dealt = applyEvent(dealt, { type: 'ACK_ROLE', by: p.id });
    const leader = dealt.players[dealt.leaderIndex]!.id;
    const announced = applyEvent(dealt, { type: 'PROPOSE_TEAM', by: leader, team: dealt.players.slice(0, 2).map((p) => p.id) });
    for (const direction of ['clockwise', 'counterclockwise'] as const) {
      const started = applyEvent(announced, { type: 'START_DISCUSSION', by: leader, direction });
      expect(started.discussion!.order).toEqual(speakingOrder(announced.players, leader, direction, 5));
    }
  });
});
