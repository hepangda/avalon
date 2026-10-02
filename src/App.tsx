import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from './i18n/provider';
import { routing, stripLocalePrefix } from './i18n/routing';
const HomePage = lazy(() => import('./pages/HomePage'));
const LobbyPage = lazy(() => import('./pages/LobbyPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
const ReplayPage = lazy(() => import('./pages/ReplayPage'));
import { AuthIdentityProvider } from '@/lib/auth/useAuthIdentity';
import { RequireAccount } from '@/components/auth/RequireAccount';

const DebugGalleryPage = import.meta.env.DEV
  ? lazy(() => import('./pages/DebugGalleryPage'))
  : null;

/** Keep existing bookmarks and invitations working, including query and hash. */
function LegacyLocaleRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${stripLocalePrefix(pathname)}${search}${hash}`} replace />;
}

export function App() {
  return (
    <I18nProvider>
      <AuthIdentityProvider>
        <Suspense fallback={<div role="status" className="p-6">AVALON…</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          {DebugGalleryPage && (
            <Route path="/debug/gallery" element={<Suspense fallback={<div className="p-6">Debug gallery…</div>}><DebugGalleryPage /></Suspense>} />
          )}
          <Route element={<RequireAccount />}>
            <Route path="/room/:code" element={<LobbyPage />} />
            <Route path="/game/:code" element={<GamePage />} />
            <Route path="/replay/:gameId" element={<ReplayPage />} />
          </Route>
          {routing.locales.map((locale) => (
            <Route key={locale} path={`/${locale}/*`} element={<LegacyLocaleRedirect />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthIdentityProvider>
    </I18nProvider>
  );
}
