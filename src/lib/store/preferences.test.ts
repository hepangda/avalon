import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browserStorage(entries: [string, string][] = []) {
  const storage = new Map(entries);
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('navigator', { languages: ['fr-FR', 'en-GB', 'zh-CN'] });
  return storage;
}

describe('browser display preferences', () => {
  it('uses supported browser languages and remembers an explicit language across reloads', async () => {
    const storage = browserStorage();
    let { useLocaleStore, browserLocale } = await import('./locale');
    expect(browserLocale(['zh-TW', 'en-US'])).toBe('zh');
    expect(browserLocale(['ja-JP'])).toBe('zh');
    expect(useLocaleStore.getState().locale).toBe('en');
    useLocaleStore.getState().setLocale('zh');
    expect(JSON.parse(storage.get('avalon-locale')!).state.locale).toBe('zh');
    vi.resetModules();
    ({ useLocaleStore } = await import('./locale'));
    expect(useLocaleStore.getState().locale).toBe('zh');
  });

  it.each(['classic', 'modern', 'furry'] as const)('restores and persists the %s card preference', async (style) => {
    const storage = browserStorage([['avalon-card-art', JSON.stringify({ version: 0, state: { style } })]]);
    const { useCardArtStore } = await import('./cardArt');
    expect(useCardArtStore.getState().style).toBe(style);
    useCardArtStore.getState().setStyle('modern');
    expect(JSON.parse(storage.get('avalon-card-art')!).state.style).toBe('modern');
  });

  it('defaults legacy voice settings to disabled and persists an independent voice channel', async () => {
    const storage = browserStorage([['avalon-sound', JSON.stringify({ version: 0, state: { volume: 0.5, muted: true, notify: true } })]]);
    let { useSoundStore, DEFAULT_VOLUME } = await import('./sound');
    expect(useSoundStore.getState()).toMatchObject({ voice: false, voiceVolume: DEFAULT_VOLUME });
    useSoundStore.getState().setVoice(false);
    useSoundStore.getState().setVoiceVolume(0.3);
    expect(useSoundStore.getState()).toMatchObject({ volume: 0.5, muted: true, notify: true, voice: false, voiceVolume: 0.3 });
    expect(JSON.parse(storage.get('avalon-sound')!).state).toMatchObject({ voice: false, voiceVolume: 0.3 });
    vi.resetModules();
    ({ useSoundStore } = await import('./sound'));
    expect(useSoundStore.getState()).toMatchObject({ volume: 0.5, muted: true, voice: false, voiceVolume: 0.3 });
  });

  it('starts with modern art when no preference has been saved', async () => {
    browserStorage();
    const { useCardArtStore } = await import('./cardArt');
    expect(useCardArtStore.getState().style).toBe('modern');
  });

  it('falls back safely for unsupported stored preferences', async () => {
    browserStorage([
      ['avalon-locale', JSON.stringify({ version: 0, state: { locale: 'invalid' } })],
      ['avalon-card-art', JSON.stringify({ version: 0, state: { style: 'invalid' } })],
    ]);
    const { useLocaleStore } = await import('./locale');
    const { useCardArtStore } = await import('./cardArt');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(useCardArtStore.getState().style).toBe('modern');
  });
});
