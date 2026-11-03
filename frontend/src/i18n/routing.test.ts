import { describe, expect, it } from 'vitest';
import { stripLocalePrefix } from './routing';

describe('language-independent links', () => {
  it.each([
    ['/zh', '/'],
    ['/en/', '/'],
    ['/zh/room/0123', '/room/0123'],
    ['/en/game/0123', '/game/0123'],
    ['/zh/replay/game-1', '/replay/game-1'],
    ['/en/debug/gallery', '/debug/gallery'],
    ['/room/0123', '/room/0123'],
    ['/english/room/0123', '/english/room/0123'],
  ])('normalizes legacy path %s to %s', (path, expected) => {
    expect(stripLocalePrefix(path)).toBe(expected);
  });

});
