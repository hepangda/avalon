import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { TableSheet } from '@/components/game/TableSheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { AuthUser } from '@/lib/auth/types';
import { accountDisplayName } from '@/lib/auth/types';
import { MAX_NAME_LENGTH, sanitizeName } from '@/lib/game/displayName';
import { cn } from '@/lib/utils/cn';

interface AccountProps {
  user: AuthUser;
  loading: boolean;
  onLogout: () => Promise<void>;
  onSaveAlias: (alias: string) => Promise<void>;
}

function AccountAvatar({ user, className }: { user: AuthUser; className?: string }) {
  const base = 'shrink-0 rounded-full border border-gold/30';
  return user.picture ? (
    <img src={user.picture} alt="" referrerPolicy="no-referrer" className={cn(base, 'object-cover', className)} />
  ) : (
    <span aria-hidden="true" className={cn(base, 'grid place-items-center bg-gold/10 font-serif text-gold', className)}>
      {accountDisplayName(user).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Account chip for the home top bar; alias and sign-out live in its sheet. */
export function AccountMenu(props: AccountProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const name = accountDisplayName(props.user);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-10 min-w-0 max-w-[13rem] items-center gap-2 rounded-full border border-gold/20 bg-ink/40 py-1 pl-1 pr-3 text-sm text-parchment/85 transition-colors hover:border-gold/45 hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <AccountAvatar user={props.user} className="h-8 w-8 text-xs" />
        <span className="sr-only">{t('home.identityTitle')}: </span>
        <span className="truncate">{name}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-parchment/45" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <TableSheet open title={t('home.identityTitle')} onClose={() => setOpen(false)}>
          <AccountSettings {...props} />
        </TableSheet>
      )}
    </>
  );
}

export function AccountSettings({ user, loading, onLogout, onSaveAlias }: AccountProps) {
  const t = useTranslations();
  const aliasId = useId();
  const current = accountDisplayName(user);
  const [draft, setDraft] = useState(current);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(accountDisplayName(user));
  }, [user?.id, user?.alias, user?.username]);

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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AccountAvatar user={user} className="h-12 w-12 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-parchment">{current}</p>
          {current !== user.username && (
            <p className="truncate text-xs text-parchment/50">{t('home.signedInAs', { name: user.username })}</p>
          )}
        </div>
      </div>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveIdentity();
        }}
      >
        <label htmlFor={aliasId} className="block text-sm font-semibold text-parchment">
          {t('home.accountAlias')}
        </label>
        <p className="text-xs text-parchment/50">{t('home.aliasHint')}</p>
        <div className="flex gap-2 pt-1">
          <Input
            id={aliasId}
            value={draft}
            disabled={saving || loading}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
              setError(null);
            }}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            className="h-11 min-w-0"
          />
          <Button type="submit" variant="secondary" className="h-11 shrink-0 px-4" disabled={saving || loading}>
            {t(saving ? 'home.savingAlias' : 'home.saveAlias')}
          </Button>
        </div>
        {error && <p role="alert" className="text-xs text-crimson-bright">{error}</p>}
        {saved && <p role="status" className="text-xs text-emerald-300/80">{t('home.aliasSaved')}</p>}
      </form>

      <div className="border-t border-gold/15 pt-4">
        <Button
          type="button"
          variant="ghost"
          className="w-full text-parchment/65"
          disabled={saving || loading}
          onClick={() => void onLogout()}
        >
          {t('home.signOut')}
        </Button>
      </div>
    </div>
  );
}
