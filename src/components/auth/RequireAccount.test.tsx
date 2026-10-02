import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { RequireAccount } from './RequireAccount';
import { IdentityPanel } from '@/components/home/IdentityPanel';

vi.mock('@/lib/auth/useAuthIdentity', () => ({ useAuthIdentity: vi.fn() }));
vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));

beforeEach(() => {
  vi.mocked(useAuthIdentity).mockReturnValue({
    user: null, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), saveAlias: vi.fn(),
  });
});

function renderRoute(path = '/room/1234') {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireAccount />}>
          <Route path="*" element={<p>protected content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('account-required UI', () => {
  it.each(['/room/1234', '/game/1234', '/replay/game-1'])(
    'requires sign-in for a direct link to %s', (path) => {
      const html = renderRoute(path);
      expect(html).not.toContain('home.signInRequiredToPlay');
      expect(html).not.toContain('common.back');
      expect(html).toContain('home.signIn');
      expect(html).not.toContain('protected content');
    },
  );

  it('waits for the session before mounting protected content', () => {
    vi.mocked(useAuthIdentity).mockReturnValue({ ...useAuthIdentity(), loading: true });
    const html = renderRoute();
    expect(html).toContain('home.signIn');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('protected content');
  });

  it('renders protected content for a signed-in account', () => {
    vi.mocked(useAuthIdentity).mockReturnValue({ ...useAuthIdentity(), user: { id: 'account', username: 'Player' } });
    expect(renderRoute()).toContain('protected content');
  });

  it('offers no nickname form while signed out, and keeps account aliases', () => {
    const props = { loading: false, onLogin: vi.fn(), onLogout: vi.fn(), onSaveAlias: vi.fn() };
    const signedOut = renderToStaticMarkup(<IdentityPanel {...props} user={null} />);
    expect(signedOut).toContain('home.signIn');
    expect(signedOut).not.toContain('<input');
    expect(signedOut).not.toContain('<form');
    const signedIn = renderToStaticMarkup(<IdentityPanel {...props} user={{ id: 'account', username: 'Player', alias: 'Alias' }} />);
    expect(signedIn).toContain('home.saveAlias');
    expect(signedIn).toContain('value="Alias"');
  });
});
