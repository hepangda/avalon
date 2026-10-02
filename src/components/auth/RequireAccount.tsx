import { PreferencesButton } from '@/components/PreferencesButton';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { Outlet,useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { AccountLogin } from './AccountLogin';

/** Direct room, game and replay links use the same account requirement as home. */
export function RequireAccount() {
  const { user, loading, login } = useAuthIdentity();
  const location = useLocation();
  const t = useTranslations();

  if (user) return <Outlet key={user.id} />;
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-8">
      <div className="absolute right-4 top-4"><PreferencesButton /></div>
      <div className="w-full max-w-md">
        <AccountLogin
          loading={loading}
          error={new URLSearchParams(location.search).has('authError') ? t('home.authFailed') : null}
          onLogin={() => login(`${location.pathname}${location.search}${location.hash}`)}
        />
      </div>
    </main>
  );
}
