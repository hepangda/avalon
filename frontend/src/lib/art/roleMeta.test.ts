import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_ART_STYLES, ROLE_TEAM_UI, roleArt } from './roleMeta';

describe('role artwork variants', () => {
  it.each(CARD_ART_STYLES)('provides cards and portraits for every role and assigned variant in %s', (style) => {
    for (const role of Object.keys(ROLE_TEAM_UI) as Array<keyof typeof ROLE_TEAM_UI>) {
      for (let variant = 0; variant < 5; variant++) {
        const art = roleArt(role, variant, style);
        expect(art.card).toMatch(`/assets/game/roles/${style}/cards/`);
        expect(art.avatar).toMatch(`/assets/game/roles/${style}/avatars/`);
        expect(existsSync(`public${art.card}`), art.card).toBe(true);
        expect(existsSync(`public${art.avatar}`), art.avatar).toBe(true);
      }
    }
  });

  it('retains the modern deck independently, wrapping variants it does not contain', () => {
    expect(roleArt('Merlin', 0, 'modern').card).toBe('/assets/game/roles/modern/cards/merlin.webp');
    expect(roleArt('LoyalServant', 4, 'modern')).toEqual(roleArt('LoyalServant', 0, 'modern'));
    expect(roleArt('Minion', 1, 'modern')).toEqual(roleArt('Minion', 0, 'modern'));
  });

  it('resolves all five classic servants and both minions to distinct paired assets', () => {
    for (const [role, count] of [['LoyalServant', 5], ['Minion', 2]] as const) {
      const cards = new Set<string>();
      for (let variant = 0; variant < count; variant++) {
        const art = roleArt(role, variant, 'classic');
        cards.add(art.card);
        expect(existsSync(`public${art.card}`)).toBe(true);
        expect(existsSync(`public${art.avatar}`)).toBe(true);
      }
      expect(cards.size).toBe(count);
    }
  });

  it('uses available furry assets for the added classic variants', () => {
    expect(roleArt('LoyalServant', 4, 'furry')).toEqual(roleArt('LoyalServant', 0, 'furry'));
    expect(roleArt('Minion', 1, 'furry')).toEqual(roleArt('Minion', 0, 'furry'));
    for (const art of [roleArt('LoyalServant', 4, 'furry'), roleArt('Minion', 1, 'furry')]) {
      expect(existsSync(`public${art.card}`)).toBe(true);
      expect(existsSync(`public${art.avatar}`)).toBe(true);
    }
  });

  it.each(CARD_ART_STYLES)('handles absent and invalid variants in %s', (style) => {
    for (const role of ['LoyalServant', 'Minion'] as const) {
      for (const variant of [undefined, -1, 0.5, NaN, Infinity]) {
        expect(roleArt(role, variant, style)).toEqual(roleArt(role, 0, style));
      }
    }
  });

  it('uses modern art by default', () => {
    expect(roleArt('Minion').card).toBe('/assets/game/roles/modern/cards/minion.webp');
  });
});
