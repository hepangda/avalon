import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AccountAvatar, AccountSettings } from '@/components/AccountSettings';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { TableSheet } from '@/components/game/TableSheet';
import { CARD_ART_STYLES } from '@/lib/preferences';
import { CARD_DECKS } from '@/lib/game/cardDecks';
import { roleArt } from '@/lib/game/roleMeta';
import { useCardArtStore } from '@/lib/store/cardArt';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { accountDisplayName } from '@/lib/auth/types';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { cn } from '@/lib/utils/cn';

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M4 7h5m4 0h7M4 17h9m4 0h3" />
      <circle cx="11" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
}

/**
 * One account preference panel shared by home, lobby, game and replay. Table headers use the
 * compact tool; home uses the account chip, which also carries the signed-in name.
 */
export function PreferencesButton({ variant = 'tool' }: { variant?: 'tool' | 'chip' }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const style = useCardArtStore((state) => state.style);
  const { user, loading, saveAlias, logout } = useAuthIdentity();
  const { save, saving, error } = useAccountPreferencesStore();

  return (
    <>
      {variant === 'chip' ? (
        <button type="button" className={cn('prefs-chip', user && 'is-account')} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {user && (
            <>
              <AccountAvatar user={user} className="prefs-chip-avatar" />
              <span className="truncate">{accountDisplayName(user)}</span>
              <span aria-hidden="true" className="prefs-chip-rule" />
            </>
          )}
          <SettingsIcon className="prefs-chip-icon" />
          <span className={user ? 'sr-only' : undefined}>{t('preferences.title')}</span>
        </button>
      ) : (
        <button type="button" className="table-tool min-h-10" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <SettingsIcon className="h-4 w-4" />
          <span>{t('preferences.title')}</span>
        </button>
      )}
      {open && (
        <TableSheet open={open} title={t('preferences.title')} className="prefs-sheet" onClose={() => setOpen(false)}>
          <div className="prefs">
            {user && (
              <AccountSettings
                key={user.id}
                user={user}
                loading={loading}
                onSaveAlias={saveAlias}
                onLogout={async () => {
                  await logout();
                  setOpen(false);
                }}
              />
            )}
            <fieldset className="prefs-section" disabled={loading || saving}>
              <legend className="prefs-label">{t('game.cardArt')}</legend>
              <div className="prefs-decks">
                {CARD_ART_STYLES.map((value) => (
                  <label key={value} className="prefs-deck">
                    <input
                      type="radio"
                      name="card-art"
                      value={value}
                      checked={style === value}
                      onChange={() => void save({ cardArt: value })}
                      className="sr-only"
                    />
                    <span className="prefs-deck-stack">
                      <img src={roleArt('Merlin', 0, value).card} alt="" draggable={false} />
                    </span>
                    <span className="prefs-deck-name">{t(`game.${CARD_DECKS[value].label}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="prefs-section">
              <span aria-hidden="true" className="prefs-label">{t('locale.switch')}</span>
              <LocaleSwitcher disabled={loading || saving} />
            </div>
            {error ? (
              <p role="alert" className="prefs-status is-error">{t('preferences.saveFailed')}</p>
            ) : (
              <p role="status" className="prefs-status">{saving ? t('preferences.saving') : null}</p>
            )}
          </div>
        </TableSheet>
      )}
    </>
  );
}
