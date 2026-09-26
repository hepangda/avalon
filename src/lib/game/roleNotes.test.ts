import { describe, expect, it } from 'vitest';
import { changeRoleNote, displayedRoleNotes, knownRoleNotes, readRoleNotes, readRoleNotesEnabled, roleNoteOptions, roleNoteTone, roleNotesKey } from './roleNotes';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { projectStateForViewer, type Role } from '@/lib/engine';

describe('private identity notes', () => {
  it('defaults to showing knowledge and restores an explicit unchecked preference', () => {
    expect(readRoleNotesEnabled('game', { getItem: () => null })).toBe(true);
    expect(readRoleNotesEnabled('game', { getItem: () => 'false' })).toBe(false);
    expect(readRoleNotesEnabled('game', { getItem: () => 'true' })).toBe(true);
    expect(readRoleNotesEnabled('game', { getItem: () => { throw Error(); } })).toBe(true);
  });

  it('allows Merlin to refine known enemies to red roles without offering a generic team or blue role', () => {
    const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p0');
    expect(knownRoleNotes(game, 'p0')).toEqual({ p0: 'Merlin', p1: 'good', p2: 'good', p3: 'evil', p4: 'evil' });
    expect(roleNoteOptions(game, 'p0', 'p3')).toEqual(['Morgana', 'Assassin']);
    expect(roleNoteOptions(game, 'p0', 'p4')).toEqual(['Morgana', 'Assassin']);
    expect(roleNoteOptions(game, 'p0', 'p2')).toContain('Percival');
    expect(displayedRoleNotes(game, 'p0', { p3: 'Morgana', p4: 'Assassin', p2: 'good' }, true))
      .toEqual({ p0: 'Merlin', p1: 'good', p3: 'Morgana', p4: 'Assassin', p2: 'good' });
    expect(displayedRoleNotes(game, 'p0', { p3: 'Percival', p4: 'evil' }, true))
      .toEqual({ p0: 'Merlin', p1: 'good', p2: 'good', p3: 'evil', p4: 'evil' });
    expect(displayedRoleNotes(game, 'p0', { p3: 'Merlin', p2: 'good' }, false)).toEqual({});
  });

  it.each([
    { mordred: false, oberon: false },
    { mordred: false, oberon: true },
    { mordred: true, oberon: false },
    { mordred: true, oberon: true },
  ])('limits Merlin’s guesses using visibility with Mordred=$mordred, Oberon=$oberon', ({ mordred, oberon }) => {
    const roles: Role[] = [...FIVE_P, ...(oberon ? ['Oberon' as const] : []), ...(mordred ? ['Mordred' as const] : [])];
    const game = projectStateForViewer(buildStartedGame(roles), 'p0');
    const visibleEvil = ['Morgana', 'Assassin', ...(oberon ? ['Oberon'] : [])];
    const unseen = [...(mordred ? ['good'] : []), 'Percival', 'LoyalServant', ...(mordred ? ['Mordred'] : [])];
    for (const known of game.knownPlayers) {
      expect(roleNoteOptions(game, 'p0', known.playerId)).toEqual(visibleEvil);
    }
    for (const player of game.players.filter((p) => p.id !== 'p0' && !game.knownPlayers.some((k) => k.playerId === p.id))) {
      expect(roleNoteOptions(game, 'p0', player.id)).toEqual(unseen);
    }
    const oldNotes = { p1: 'Oberon', p2: 'Mordred', p3: 'Mordred' } as const;
    const displayed = displayedRoleNotes(game, 'p0', oldNotes, true);
    expect(displayed.p1).toBe(mordred ? undefined : 'good');
    expect(displayed.p2).toBe(mordred ? 'Mordred' : 'good');
    expect(displayed.p3).toBe('evil');
    expect(oldNotes).toEqual({ p1: 'Oberon', p2: 'Mordred', p3: 'Mordred' });
  });

  it('automatically marks both teams for Merlin without Mordred and restores blue after clearing a role guess', () => {
    const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p0');
    const automatic = knownRoleNotes(game, 'p0');
    expect(Object.keys(automatic)).toHaveLength(game.players.length);
    expect(roleNoteOptions(game, 'p0', 'p1')).toEqual(['Percival', 'LoyalServant']);
    const manual = { p1: 'LoyalServant' } as const;
    expect(displayedRoleNotes(game, 'p0', manual, true).p1).toBe('LoyalServant');
    expect(displayedRoleNotes(game, 'p0', changeRoleNote(manual, 'p1', null), true)).toEqual(automatic);
    expect(displayedRoleNotes(game, 'p0', manual, false)).toEqual({});
    expect(manual).toEqual({ p1: 'LoyalServant' });
  });

  it('keeps Percival’s candidate identities restricted to Merlin and Morgana and restores ambiguity after clearing a guess', () => {
    const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p1');
    expect(knownRoleNotes(game, 'p1')).toEqual({ p1: 'Percival', p0: 'merlin-or-morgana', p3: 'merlin-or-morgana' });
    expect(roleNoteOptions(game, 'p1', 'p0')).toEqual(['Merlin', 'Morgana']);
    const manual = { p0: 'Morgana', p3: 'Assassin' } as const;
    expect(displayedRoleNotes(game, 'p1', manual, true)).toMatchObject({ p0: 'Morgana', p3: 'merlin-or-morgana' });
    expect(displayedRoleNotes(game, 'p1', changeRoleNote(manual, 'p0', null), true).p0).toBe('merlin-or-morgana');
  });

  it('only offers the remaining red role for Percival when Morgana has one other red role in the lineup', () => {
    const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p1');
    for (const target of ['p2', 'p4']) {
      expect(roleNoteOptions(game, 'p1', target)).toEqual(['LoyalServant', 'percival-claim', 'Assassin']);
    }
    const oldNotes = { p2: 'Merlin', p4: 'evil' } as const;
    expect(displayedRoleNotes(game, 'p1', oldNotes, true)).toEqual(knownRoleNotes(game, 'p1'));
    expect(displayedRoleNotes(game, 'p1', { p2: 'Morgana', p4: 'Assassin' }, true)).toEqual({
      ...knownRoleNotes(game, 'p1'), p4: 'Assassin',
    });
    expect(oldNotes).toEqual({ p2: 'Merlin', p4: 'evil' });
  });

  it.each(['Mordred', 'Oberon', 'Minion'] as const)(
    'keeps a generic red note for Percival when Assassin and %s both remain possible',
    (extraRole) => {
      const game = projectStateForViewer(buildStartedGame([...FIVE_P, extraRole]), 'p1');
      expect(roleNoteOptions(game, 'p1', 'p2')).toEqual(['LoyalServant', 'percival-claim', 'evil', 'Assassin', extraRole]);
      expect(roleNoteOptions(game, 'p1', 'p0')).toEqual(['Merlin', 'Morgana']);
      expect(roleNoteOptions(game, 'p1', 'p3')).toEqual(['Merlin', 'Morgana']);
    },
  );

  it('lets only Percival record neutral counterclaims on unknown seats and preserves servant guesses', () => {
    const state = buildStartedGame(FIVE_P);
    const game = projectStateForViewer(state, 'p1');
    const notes = readRoleNotes('test', { getItem: () => JSON.stringify({ p2: 'percival-claim', p4: 'LoyalServant' }) });
    expect(notes.p2).toBe('percival-claim');
    expect(roleNoteTone('percival-claim')).toBe('claim');
    expect(displayedRoleNotes(game, 'p1', notes, true)).toEqual({ ...knownRoleNotes(game, 'p1'), p2: 'percival-claim', p4: 'LoyalServant' });
    expect(displayedRoleNotes(game, 'p1', notes, false)).toEqual({});
    expect(displayedRoleNotes(game, 'p1', changeRoleNote(notes, 'p2', null), true)).toEqual({ ...knownRoleNotes(game, 'p1'), p4: 'LoyalServant' });
    expect(roleNoteOptions(game, 'p1', 'p2')).not.toContain('good');
    expect(displayedRoleNotes(game, 'p1', { p0: 'percival-claim', p3: 'percival-claim' }, true)).toEqual(knownRoleNotes(game, 'p1'));
    for (const viewer of ['p0', 'p2', 'p3', 'p4', 'spectator']) {
      const other = projectStateForViewer(state, viewer);
      expect(roleNoteOptions(other, viewer, 'p2')).not.toContain('percival-claim');
      expect(displayedRoleNotes(other, viewer, notes, true).p2).not.toBe('percival-claim');
    }
    expect(roleNoteOptions(game, 'p1', 'p1')).toEqual([]);
  });

  it('marks exact red teammate roles without exposing Oberon or giving Oberon teammates', () => {
    const state = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'Morgana', 'Assassin', 'Mordred', 'Oberon']);
    const game = projectStateForViewer(state, 'p3');
    expect(knownRoleNotes(game, 'p3')).toEqual({ p3: 'Morgana', p4: 'Assassin', p5: 'Mordred' });
    expect(roleNoteOptions(game, 'p3', 'p4')).toEqual([]);
    expect(displayedRoleNotes(game, 'p3', { p4: 'Merlin' }, true).p4).toBe('Assassin');
    expect(knownRoleNotes(projectStateForViewer(state, 'p6'), 'p6')).toEqual({ p6: 'Oberon' });
    expect(knownRoleNotes(projectStateForViewer(state, 'spectator'), null)).toEqual({});
  });

  it.each(['Morgana', 'Assassin', 'Mordred', 'Minion'] as const)(
    '%s can only mark unknown players as blue roles or an unseen Oberon',
    (role) => {
      const state = buildStartedGame(['Merlin', 'Percival', 'LoyalServant', 'Morgana', 'Assassin', 'Mordred', 'Minion', 'Oberon']);
      const viewer = state.players.find((p) => p.role === role)!;
      const game = projectStateForViewer(state, viewer.id);
      expect(roleNoteOptions(game, viewer.id, 'p0')).toEqual([
        'Merlin', 'Percival', 'LoyalServant', 'Oberon',
      ]);
      expect(roleNoteOptions(game, viewer.id, viewer.id)).toEqual([]);
      for (const known of game.knownPlayers) {
        expect(roleNoteOptions(game, viewer.id, known.playerId)).toEqual([]);
      }
    },
  );

  it('lets Oberon mark both teams and all other roles without automatically revealing teammates', () => {
    const roles: Role[] = ['Merlin', 'Percival', 'LoyalServant', 'Morgana', 'Assassin', 'Mordred', 'Minion', 'Oberon'];
    const game = projectStateForViewer(buildStartedGame(roles), 'p7');
    expect(game.knownPlayers).toEqual([]);
    expect(knownRoleNotes(game, 'p7')).toEqual({ p7: 'Oberon' });
    for (const player of game.players.filter((p) => p.id !== 'p7')) {
      expect(roleNoteOptions(game, 'p7', player.id)).toEqual(['good', 'evil', ...roles.slice(0, -1)]);
    }
    expect(roleNoteOptions(game, 'p7', 'p7')).toEqual([]);
    const manual = { p0: 'Morgana', p1: 'good', p2: 'evil', p3: 'Assassin', p4: 'Merlin' } as const;
    expect(displayedRoleNotes(game, 'p7', manual, true)).toEqual({ ...manual, p7: 'Oberon' });
    expect(displayedRoleNotes(game, 'p7', manual, false)).toEqual({});
  });

  it('does not offer an absent Oberon or reuse old red-team guesses under the new restrictions', () => {
    const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p3');
    expect(roleNoteOptions(game, 'p3', 'p0')).toEqual(['Merlin', 'Percival', 'LoyalServant']);
    expect(displayedRoleNotes(game, 'p3', { p0: 'evil', p1: 'Morgana', p2: 'Percival', p4: 'Merlin' }, true))
      .toEqual({ p0: 'good', p1: 'good', p3: 'Morgana', p4: 'Assassin', p2: 'Percival' });
  });

  it.each(['Morgana', 'Assassin', 'Mordred', 'Minion'] as const)(
    'automatically marks all teams for %s only when Oberon is absent',
    (role) => {
      const roles: Role[] = ['Merlin', 'Percival', 'LoyalServant', 'Morgana', 'Assassin', 'Mordred', 'Minion'];
      const state = buildStartedGame(roles);
      const viewer = state.players.find((p) => p.role === role)!;
      const game = projectStateForViewer(state, viewer.id);
      const automatic = knownRoleNotes(game, viewer.id);
      expect(automatic).toEqual({ p0: 'good', p1: 'good', p2: 'good', p3: 'Morgana', p4: 'Assassin', p5: 'Mordred', p6: 'Minion' });
      expect(roleNoteOptions(game, viewer.id, 'p0')).toEqual(['Merlin', 'Percival', 'LoyalServant']);
      const manual = { p0: 'Percival' } as const;
      expect(displayedRoleNotes(game, viewer.id, manual, true).p0).toBe('Percival');
      expect(displayedRoleNotes(game, viewer.id, changeRoleNote(manual, 'p0', null), true)).toEqual(automatic);
      expect(displayedRoleNotes(game, viewer.id, manual, false)).toEqual({});
      expect(manual).toEqual({ p0: 'Percival' });
      const withOberon = projectStateForViewer(buildStartedGame([...roles, 'Oberon']), viewer.id);
      expect(knownRoleNotes(withOberon, viewer.id).p0).toBeUndefined();
      expect(knownRoleNotes(withOberon, viewer.id).p7).toBeUndefined();
    },
  );

  it('hides all notes without deleting guesses and restores them with known information on re-enable', () => {
    const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p0');
    const manual = { p2: 'Percival', p3: 'Morgana' } as const;
    const visible = displayedRoleNotes(game, 'p0', manual, true);
    expect(displayedRoleNotes(game, 'p0', manual, false)).toEqual({});
    expect(manual).toEqual({ p2: 'Percival', p3: 'Morgana' });
    expect(displayedRoleNotes(game, 'p0', manual, true)).toEqual(visible);
    expect(visible).toEqual({ p1: 'good', p2: 'Percival', p0: 'Merlin', p3: 'Morgana', p4: 'evil' });
  });

  it('restores notes after a reload without leaking between rooms, games, viewers or role assignments', () => {
    const key = roleNotesKey('1234', 'game-1', 'p0', 0);
    const saved = new Map([[key, JSON.stringify({ p1: 'Merlin', p2: 'evil' })]]);
    const storage = { getItem: (key: string) => saved.get(key) ?? null };
    expect(readRoleNotes(key, storage)).toEqual({ p1: 'Merlin', p2: 'evil' });
    for (const other of [
      roleNotesKey('5678', 'game-1', 'p0', 0),
      roleNotesKey('1234', 'game-2', 'p0', 0),
      roleNotesKey('1234', 'game-1', 'p1', 0),
      roleNotesKey('1234', 'game-1', null, 0),
      roleNotesKey('1234', 'game-1', 'p0', 1),
    ]) expect(readRoleNotes(other, storage)).toEqual({});
  });

  it('replaces and clears one player note while preserving other notes', () => {
    const original = { p0: 'good', p1: 'Merlin' } as const;
    const changed = changeRoleNote(original, 'p0', 'Percival');
    expect(changed).toEqual({ p0: 'Percival', p1: 'Merlin' });
    expect(changeRoleNote(changed, 'p0', null)).toEqual({ p1: 'Merlin' });
    expect(original.p0).toBe('good');
  });

  it('ignores damaged storage and invalid role values', () => {
    for (const value of ['null', '[]', 'invalid', '12']) {
      expect(readRoleNotes('notes', { getItem: () => value })).toEqual({});
    }
    expect(readRoleNotes('notes', { getItem: () => JSON.stringify({
      p0: 'Merlin', p1: 'invented', p2: 'toString', p3: 12, p4: 'evil',
    }) })).toEqual({ p0: 'Merlin', p4: 'evil' });
    expect(readRoleNotes('notes', { getItem: () => { throw new Error('Storage blocked'); } })).toEqual({});
  });
});
