import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MAX_NAME_LENGTH, sanitizeName } from '@/lib/game/displayName';
import { Input } from '@/components/ui/Input';
import type { AuthUser } from '@/lib/auth/useAuthIdentity';
import { accountDisplayName } from '@/lib/auth/types';
import { useSessionStore } from '@/lib/store/session';

interface IdentityPanelProps {
  user: AuthUser | null;
  loading: boolean;
  authError?: string | null;
  onLogin: () => void;
  onLogout: () => Promise<void>;
  onSaveAlias: (alias: string) => Promise<void>;
}

export function IdentityPanel({
  user,
  loading,
  authError,
  onLogin,
  onLogout,
  onSaveAlias,
}: IdentityPanelProps) {
  const t = useTranslations();
  const lastName = useSessionStore((state) => state.lastName);
  const setLastName = useSessionStore((state) => state.setLastName);
  const [draft, setDraft] = useState(user ? accountDisplayName(user) : lastName);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    setDraft(user ? accountDisplayName(user) : lastName);
  }, [user?.id, user?.alias, user?.username, lastName]);

  async function saveIdentity() {
    if (saving || loading) return;
    const name = sanitizeName(draft);
    if (!name) {
      setSaved(false);
      setError(t('home.nameEmpty'));
      return;
    }
    setSaved(false);
    setError(null);
    if (user) {
      setSaving(true);
      try {
        await onSaveAlias(name);
        setDraft(name);
        setSaved(true);
      } catch (error) {
        setError(
          t(
            error instanceof Error && error.message === 'AUTH_REQUIRED'
              ? 'home.authLoginRequired'
              : 'home.aliasSaveFailed',
          ),
        );
      } finally {
        setSaving(false);
      }
    } else {
      setDraft(name);
      setLastName(name);
      setSaved(true);
    }
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
                {accountDisplayName(user).slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="max-w-28 truncate text-sm text-parchment">
              {accountDisplayName(user)}
            </span>
            <button
              type="button"
              className="shrink-0 text-xs text-parchment/40 hover:text-parchment/70"
              disabled={saving}
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

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveIdentity();
        }}
      >
        {user && (
          <label htmlFor={inputId} className="text-xs text-parchment/70">
            {t('home.accountAlias')}
          </label>
        )}
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={draft}
            disabled={saving || loading}
            aria-label={t(user ? 'home.accountAlias' : 'home.anonymousNamePlaceholder')}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
              setError(null);
            }}
            placeholder={t(user ? 'home.accountAlias' : 'home.anonymousNamePlaceholder')}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            className="h-10 min-w-0"
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-10 shrink-0 px-4 text-xs"
            disabled={saving || loading}
          >
            {t(saving ? 'home.savingAlias' : user ? 'home.saveAlias' : 'home.useAnonymousName')}
          </Button>
        </div>
        {user && <p className="text-xs text-parchment/45">{t('home.aliasHint')}</p>}
      </form>

      {!user && !lastName.trim() && (
        <p className="text-xs text-parchment/45">{t('home.nameLimit')}</p>
      )}

      {authError && <p className="text-xs text-crimson">{authError}</p>}
      {error && (
        <p role="alert" className="text-xs text-crimson">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-emerald-300/75">
          {t(user ? 'home.aliasSaved' : 'home.identitySaved')}
        </p>
      )}
    </Card>
  );
}
