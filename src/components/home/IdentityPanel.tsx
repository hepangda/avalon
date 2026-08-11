import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { AuthUser } from '@/lib/auth/useAuthIdentity';
import { useSessionStore } from '@/lib/store/session';

interface IdentityPanelProps {
  user: AuthUser | null;
  loading: boolean;
  authError?: string | null;
  onLogin: () => void;
  onLogout: () => Promise<void>;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 24);
}

export function IdentityPanel({ user, loading, authError, onLogin, onLogout }: IdentityPanelProps) {
  const t = useTranslations();
  const lastName = useSessionStore((state) => state.lastName);
  const setLastName = useSessionStore((state) => state.setLastName);
  const [draft, setDraft] = useState(lastName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft && lastName) setDraft(lastName);
  }, [draft, lastName]);

  function saveAnonymousIdentity() {
    const name = normalizeName(draft);
    if (!name) {
      setSaved(false);
      setError(t('home.nameEmpty'));
      return;
    }
    setDraft(name);
    setLastName(name);
    setError(null);
    setSaved(true);
  }

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-sm font-semibold text-gold">{t('home.identityTitle')}</p>
          <p className="truncate text-xs text-parchment/45">
            {user
              ? t('home.accountIdentity')
              : lastName
                ? t('home.anonymousIdentity', { name: lastName })
                : t('home.identityHint')}
          </p>
        </div>

        {user ? (
          <div className="flex min-w-0 items-center gap-2">
            {user.picture ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="h-8 w-8 shrink-0 rounded-full border border-gold/25 object-cover"
              />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/25 bg-gold/10 text-xs text-gold">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="max-w-28 truncate text-sm text-parchment">{user.username}</span>
            <button
              type="button"
              className="shrink-0 text-xs text-parchment/40 hover:text-parchment/70"
              onClick={() => void onLogout()}
            >
              {t('home.signOut')}
            </button>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="h-9 shrink-0 border border-gold/25 px-3 text-xs"
            disabled={loading}
            onClick={onLogin}
          >
            {t('home.signIn')}
          </Button>
        )}
      </div>

      {!user && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveAnonymousIdentity();
            }}
            placeholder={t('home.anonymousNamePlaceholder')}
            maxLength={24}
            autoComplete="nickname"
            className="h-10 min-w-0"
          />
          <Button
            variant="secondary"
            className="h-10 shrink-0 px-4 text-xs"
            onClick={saveAnonymousIdentity}
          >
            {t('home.useAnonymousName')}
          </Button>
        </div>
      )}

      {authError && <p className="text-xs text-crimson">{authError}</p>}
      {error && <p className="text-xs text-crimson">{error}</p>}
      {saved && <p className="text-xs text-emerald-300/75">{t('home.identitySaved')}</p>}
    </Card>
  );
}
