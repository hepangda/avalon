import { create } from 'zustand';
import type { AuthUser } from '@/lib/auth/types';
import { DEFAULT_CARD_ART_STYLE, DEFAULT_SOUND_PREFERENCES, type DisplayPreferences } from '@/lib/preferences';
import { browserLocale, useLocaleStore } from './locale';
import { useSoundStore } from './sound';
import { useCardArtStore } from './cardArt';
import { usePrivacyStore } from './privacy';

function currentPreferences(): DisplayPreferences {
  const { volume, muted, voice, voiceVolume, notify } = useSoundStore.getState();
  return { volume, muted, voice, voiceVolume, notify, locale: useLocaleStore.getState().locale, cardArt: useCardArtStore.getState().style,
    hideRecord: usePrivacyStore.getState().hideRecord };
}

function apply(preferences: DisplayPreferences) {
  const { volume, muted, voice, voiceVolume, notify } = preferences;
  useSoundStore.setState({ volume, muted, voice, voiceVolume, notify });
  useLocaleStore.getState().setLocale(preferences.locale);
  useCardArtStore.getState().setStyle(preferences.cardArt);
  usePrivacyStore.setState({ hideRecord: preferences.hideRecord });
}

interface AccountPreferencesState {
  accountId: string | null;
  revision: number;
  saving: boolean;
  error: boolean;
  hydrate: (user: AuthUser | null, requestRevision?: number) => void;
  save: (patch: Partial<DisplayPreferences>) => Promise<void>;
}

/** Server authority for signed-in accounts; local stores are the display cache. */
export const useAccountPreferencesStore = create<AccountPreferencesState>((set, get) => ({
  accountId: null,
  revision: 0,
  saving: false,
  error: false,
  hydrate: (user, requestRevision = get().revision) => {
    const state = get();
    const accountId = user?.id ?? null;
    const changedAccount = accountId !== state.accountId;
    // Ignore a focus/session request that raced with an edit on this account.
    if (!changedAccount && (state.saving || requestRevision !== state.revision)) return;
    set({ accountId, saving: false, error: false, revision: state.revision + 1 });
    if (user) {
      apply({
        ...DEFAULT_SOUND_PREFERENCES,
        ...user.preferences,
        locale: user.preferences?.locale ?? browserLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
        cardArt: user.preferences?.cardArt ?? DEFAULT_CARD_ART_STYLE,
        hideRecord: user.preferences?.hideRecord === true,
      });
    } else if (changedAccount) {
      useSoundStore.setState(DEFAULT_SOUND_PREFERENCES);
      usePrivacyStore.setState({ hideRecord: false });
    }
  },
  save: async (patch) => {
    const state = get();
    if (state.saving) return;
    const previous = currentPreferences();
    const next = { ...previous, ...patch };
    const revision = state.revision + 1;
    set({ revision, error: false, saving: Boolean(state.accountId) });
    apply(next);
    if (!state.accountId) return;
    try {
      const response = await fetch('/api/auth/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error('PREFERENCES_SAVE_FAILED');
      const { preferences } = await response.json() as { preferences: Partial<DisplayPreferences> };
      if (get().revision !== revision || get().accountId !== state.accountId) return;
      apply({ ...next, ...preferences });
      set({ saving: false, revision: revision + 1 });
    } catch {
      if (get().revision !== revision || get().accountId !== state.accountId) return;
      apply(previous);
      set({ saving: false, error: true, revision: revision + 1 });
    }
  },
}));
