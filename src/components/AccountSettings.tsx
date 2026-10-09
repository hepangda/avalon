import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { accountDisplayName, type AuthUser } from '@/lib/auth/types';
import { MAX_NAME_LENGTH, sanitizeName } from '@/lib/game/displayName';
import { cn } from '@/lib/utils/cn';

export function AccountAvatar({ user, className }: { user: AuthUser; className?: string }) {
  return user.picture ? (
    <img src={user.picture} alt="" referrerPolicy="no-referrer" className={cn('prefs-avatar', className)} />
  ) : (
    <span aria-hidden="true" className={cn('prefs-avatar', className)}>
      {accountDisplayName(user).slice(0, 1).toUpperCase()}
    </span>
  );
}

interface AccountSettingsProps {
  user: AuthUser;
  loading: boolean;
  onSaveAlias: (alias: string) => Promise<void>;
  onLogout: () => void;
}

/** Nameplate at the top of settings: the alias is edited in place, like the lobby's room name. */
export function AccountSettings({ user, loading, onSaveAlias, onLogout }: AccountSettingsProps) {
  const t = useTranslations();
  const current = accountDisplayName(user);
  const [draft, setDraft] = useState(current);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discard = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(current);
  }, [current, editing]);

  async function commit() {
    if (saving) return;
    const name = sanitizeName(draft);
    if (name === current) return setEditing(false);
    if (!name) {
      setError(t('home.nameEmpty'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSaveAlias(name);
      setEditing(false);
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

  function cancel() {
    setDraft(current);
    setError(null);
    setEditing(false);
  }

  return (
    <section className="prefs-plate" aria-label={t('home.accountAlias')}>
      <AccountAvatar user={user} className="prefs-plate-avatar" />
      <div className="prefs-plate-body">
        {editing ? (
          <form
            className="prefs-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              void commit();
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={MAX_NAME_LENGTH}
              disabled={saving}
              aria-label={t('home.accountAlias')}
              aria-invalid={error ? true : undefined}
              autoComplete="nickname"
              enterKeyHint="done"
              className="prefs-name prefs-name-input"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                discard.current = true;
                event.currentTarget.blur();
              }}
              onBlur={() => {
                if (discard.current) {
                  discard.current = false;
                  return cancel();
                }
                void commit();
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className="prefs-name"
            disabled={loading}
            aria-label={`${t('home.accountAlias')}: ${current}`}
            onClick={() => setEditing(true)}
          >
            <span className="truncate">{current}</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m10.5 2.5 3 3L6 13H3v-3z" />
            </svg>
          </button>
        )}
        {error ? (
          <p role="alert" className="prefs-plate-meta is-error">{error}</p>
        ) : current !== user.username ? (
          <p className="prefs-plate-meta">{t('home.signedInAs', { name: user.username })}</p>
        ) : null}
      </div>
      {editing ? (
        <button
          type="button"
          className="prefs-plate-action is-confirm"
          disabled={saving}
          aria-busy={saving}
          aria-label={t(saving ? 'home.savingAlias' : 'home.saveAlias')}
          // Keep focus in the field so its blur does not save a second time.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void commit()}
        >
          {saving ? (
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4.5 10.5 3.5 3.5 7.5-8" />
            </svg>
          )}
        </button>
      ) : (
        <button
          type="button"
          className="prefs-plate-action"
          disabled={loading}
          aria-label={t('home.signOut')}
          title={t('home.signOut')}
          onClick={onLogout}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
          </svg>
        </button>
      )}
    </section>
  );
}
