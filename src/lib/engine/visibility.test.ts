import { describe, it, expect } from 'vitest';
import type { Role } from './types';
import { computeKnownPlayers } from './visibility';

function mk(roles: Role[]) {
  return roles.map((role, i) => ({ id: `p${i}`, role }));
}

describe('computeKnownPlayers — role visibility matrix', () => {
  it('Merlin sees all evil EXCEPT Mordred, and DOES see Oberon', () => {
    const all = mk(['Merlin', 'Mordred', 'Oberon', 'Assassin', 'LoyalServant']);
    const known = computeKnownPlayers(all[0]!, all);
    const seenIds = known.map((k) => k.playerId).sort();
    // p1 = Mordred excluded; p2 Oberon and p3 Assassin included.
    expect(seenIds).toEqual(['p2', 'p3']);
    expect(known.every((k) => k.shownAs === 'evil' && k.certain)).toBe(true);
  });

  it('Merlin cannot see Mordred', () => {
    const all = mk(['Merlin', 'Mordred', 'LoyalServant', 'LoyalServant', 'Assassin']);
    const known = computeKnownPlayers(all[0]!, all);
    expect(known.find((k) => k.playerId === 'p1')).toBeUndefined();
    expect(known.map((k) => k.playerId)).toEqual(['p4']); // only Assassin
  });

  it('Percival sees Merlin and Morgana, indistinguishable', () => {
    const all = mk(['Percival', 'Merlin', 'Morgana', 'LoyalServant', 'Assassin']);
    const known = computeKnownPlayers(all[0]!, all);
    const seen = known.map((k) => k.playerId).sort();
    expect(seen).toEqual(['p1', 'p2']);
    expect(known.every((k) => k.shownAs === 'merlin-or-morgana' && k.certain === false)).toBe(true);
  });

  it('Percival with no Morgana sees only Merlin, still ambiguous', () => {
    const all = mk(['Percival', 'Merlin', 'LoyalServant', 'Minion', 'Assassin']);
    const known = computeKnownPlayers(all[0]!, all);
    expect(known).toHaveLength(1);
    expect(known[0]!.playerId).toBe('p1');
    expect(known[0]!.shownAs).toBe('merlin-or-morgana');
  });

  it('evil players see each other but NOT Oberon', () => {
    const all = mk(['Morgana', 'Assassin', 'Mordred', 'Oberon', 'Merlin']);
    const known = computeKnownPlayers(all[0]!, all); // Morgana
    const seen = known.map((k) => k.playerId).sort();
    expect(seen).toEqual(['p1', 'p2']); // Assassin, Mordred — not Oberon(p3)
    expect(known.every((k) => k.shownAs === 'known-ally' && k.certain)).toBe(true);
  });

  it('Oberon sees no one', () => {
    const all = mk(['Oberon', 'Morgana', 'Assassin', 'Merlin', 'LoyalServant']);
    expect(computeKnownPlayers(all[0]!, all)).toEqual([]);
  });

  it('Oberon does not appear in any other evil player list', () => {
    const all = mk(['Oberon', 'Morgana', 'Assassin', 'Merlin', 'LoyalServant']);
    for (const evil of [all[1]!, all[2]!]) {
      const known = computeKnownPlayers(evil, all);
      expect(known.find((k) => k.playerId === 'p0')).toBeUndefined();
    }
  });

  it('LoyalServant sees no one', () => {
    const all = mk(['LoyalServant', 'Merlin', 'Assassin', 'Morgana', 'Percival']);
    expect(computeKnownPlayers(all[0]!, all)).toEqual([]);
  });

  it('viewer never appears in their own known list', () => {
    const all = mk(['Merlin', 'Assassin', 'Morgana', 'Oberon', 'LoyalServant']);
    for (const v of all) {
      const known = computeKnownPlayers(v, all);
      expect(known.find((k) => k.playerId === v.id)).toBeUndefined();
    }
  });
});
