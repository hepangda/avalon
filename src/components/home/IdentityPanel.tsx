import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MAX_NAME_LENGTH, sanitizeName } from '@/lib/game/displayName';
import { Input } from '@/components/ui/Input';
import { useAuthIdentity, type AuthUser } from '@/lib/auth/useAuthIdentity';
import { accountDisplayName } from '@/lib/auth/types';

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
  const { refresh } = useAuthIdentity();
  useEffect(() => { if (user) void refresh(); }, [refresh, user?.id]);
  const [draft, setDraft] = useState(user ? accountDisplayName(user) : '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(user ? accountDisplayName(user) : '');
  }, [user?.id, user?.alias, user?.username]);

  async function saveIdentity() {
    if (!user || saving || loading) return;
    const name = sanitizeName(draft);
    if (!name) {
      setSaved(false);
      setError(t('home.nameEmpty'));
      return;
    }
    setSaved(false);
    setError(null);
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
  }

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 font-serif text-sm font-semibold text-gold">{t('home.identityTitle')}</p>

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

      {user && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveIdentity();
          }}
        >
          <div className="flex gap-2">
            <Input
              value={draft}
              disabled={saving || loading}
              aria-label={t('home.accountAlias')}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
                setError(null);
              }}
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
              {t(saving ? 'home.savingAlias' : 'home.saveAlias')}
            </Button>
          </div>
        </form>
      )}

      {authError && <p className="text-xs text-crimson">{authError}</p>}
      {error && (
        <p role="alert" className="text-xs text-crimson">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-emerald-300/75">
          {t('home.aliasSaved')}
        </p>
      )}
    </Card>
  );
}
