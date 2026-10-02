import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Link } from './navigation';
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

  it('keeps room links and their query/hash independent of the current language path', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/en']}>
        <Link href="/room/0123?from=invite#seats">Join</Link>
      </MemoryRouter>,
    );
    expect(html).toContain('href="/room/0123?from=invite#seats"');
  });
});
