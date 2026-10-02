import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { TableSheet } from '@/components/game/TableSheet';
import { CARD_ART_STYLES } from '@/lib/preferences';
import { CARD_DECKS } from '@/lib/game/cardDecks';
import { RoleCard } from '@/components/game/RoleCard';
import { useCardArtStore } from '@/lib/store/cardArt';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { cn } from '@/lib/utils/cn';

/** One account preference panel shared by home, lobby, game and replay. */
export function PreferencesButton() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const style = useCardArtStore((state) => state.style);
  const { user, loading } = useAuthIdentity();
  const { save, saving, error } = useAccountPreferencesStore();

  return (
    <>
      <button
        type="button"
        className="table-tool min-h-10"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M4 7h5m4 0h7M4 17h9m4 0h3" />
          <circle cx="11" cy="7" r="2" />
          <circle cx="15" cy="17" r="2" />
        </svg>
        <span>{t('preferences.title')}</span>
      </button>
      {open && (
        <TableSheet open={open} title={t('preferences.title')} onClose={() => setOpen(false)}>
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-parchment">{t('locale.switch')}</span>
              <LocaleSwitcher disabled={loading || saving} />
            </div>
            <fieldset disabled={loading || saving}>
              <legend className="mb-3 text-sm font-semibold text-parchment">{t('game.cardArt')}</legend>
              <div className="grid grid-cols-3 gap-3">
                {CARD_ART_STYLES.map((value) => (
                  <label key={value} className="relative min-w-0 cursor-pointer">
                    <input
                      type="radio"
                      name="card-art"
                      value={value}
                      checked={style === value}
                      onChange={() => void save({ cardArt: value })}
                      className="peer sr-only"
                    />
                    <div className={cn(
                      'block overflow-hidden rounded-lg border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold',
                      style === value ? 'border-gold bg-gold/10 text-gold' : 'border-gold/20 bg-ink/40 text-parchment/65 hover:border-gold/60',
                    )}>
                      <RoleCard role="Merlin" style={value} size="compact" />
                      <span className="flex min-h-11 items-center justify-center gap-1 px-1 py-2 text-sm">
                        {style === value && <span aria-hidden="true">✓</span>}
                        {t(`game.${CARD_DECKS[value].label}`)}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
            {error && <p role="alert" className="text-sm text-crimson">{t('preferences.saveFailed')}</p>}
            <p role="status" className="text-xs leading-relaxed text-parchment/50">
              {t(saving ? 'preferences.saving' : user ? 'preferences.accountHint' : 'preferences.hint')}
            </p>
          </div>
        </TableSheet>
      )}
    </>
  );
}
