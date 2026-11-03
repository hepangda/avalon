import { describe,expect,it } from 'vitest';
import { rerollHintKey } from './RoleReveal';

const ready = { open: true, signedIn: true, cards: 1, connected: true };

describe('reroll hint', () => {
  it('stays quiet while the card can be used', () => {
    expect(rerollHintKey(ready)).toBeNull();
  });

  it('explains a closed opening before any account or connection reason', () => {
    expect(rerollHintKey({ open: false, signedIn: false, cards: 0, connected: false })).toBe('reroll.unavailable');
  });

  it('asks guests to sign in before mentioning cards', () => {
    expect(rerollHintKey({ ...ready, signedIn: false, cards: 0 })).toBe('reroll.loginShort');
  });

  it('reports an empty wallet', () => {
    expect(rerollHintKey({ ...ready, cards: 0, connected: false })).toBe('reroll.empty');
  });

  it('waits for the connection when everything else allows a reroll', () => {
    expect(rerollHintKey({ ...ready, connected: false })).toBe('reroll.reconnecting');
  });
});
