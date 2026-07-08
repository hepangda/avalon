import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { I18nProvider } from './i18n/provider';
import { isLocale, routing } from './i18n/routing';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import ReplayPage from './pages/ReplayPage';

/**
 * Validates the `:locale` segment and provides i18n for everything under it.
 * An unknown locale falls back to the default (mirrors the old server-side
 * locale redirect + next-intl `notFound()`).
 */
function LocaleLayout() {
  const { locale } = useParams();
  if (!isLocale(locale)) return <Navigate to={`/${routing.defaultLocale}`} replace />;
  return (
    <I18nProvider>
      <Outlet />
    </I18nProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${routing.defaultLocale}`} replace />} />
      <Route path="/:locale" element={<LocaleLayout />}>
        <Route index element={<HomePage />} />
        <Route path="room/:code" element={<LobbyPage />} />
        <Route path="game/:code" element={<GamePage />} />
        <Route path="replay/:gameId" element={<ReplayPage />} />
      </Route>
      <Route path="*" element={<Navigate to={`/${routing.defaultLocale}`} replace />} />
    </Routes>
  );
}
