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
