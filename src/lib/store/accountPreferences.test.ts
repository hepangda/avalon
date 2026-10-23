import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  vi.stubGlobal('navigator', { languages: ['zh-CN'] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function harness() {
  const { useAccountPreferencesStore: store } = await import('./accountPreferences');
  const { useLocaleStore } = await import('./locale');
  const { useCardArtStore } = await import('./cardArt');
  const display = () => ({ locale: useLocaleStore.getState().locale, cardArt: useCardArtStore.getState().style });
  store.getState().hydrate({ id: 'a', username: 'A', preferences: { locale: 'en', cardArt: 'modern' } });
  return { store, display };
}

describe('account preferences synchronization', () => {
  it('uses account settings over the local cache and resets missing values for another account', async () => {
    const { store, display } = await harness();
    expect(display()).toEqual({ locale: 'en', cardArt: 'modern' });
    store.getState().hydrate({ id: 'b', username: 'B' });
    expect(display()).toEqual({ locale: 'zh', cardArt: 'modern' });
  });

  it('restores server audio preferences, saves edits, and uses defaults for another account', async () => {
    const { store } = await harness();
    const { useSoundStore: sound } = await import('./sound');
    expect(sound.getState()).toMatchObject({ muted: false, voice: false, volume: 0.7, voiceVolume: 0.7, notify: false });
    store.getState().hydrate({ id: 'a', username: 'A', preferences: { voice: true, muted: true, volume: 0.4, voiceVolume: 0.8, notify: true } });
    expect(sound.getState()).toMatchObject({ voice: true, muted: true, volume: 0.4, voiceVolume: 0.8, notify: true });
    const fetcher = vi.fn(async () => Response.json({ preferences: { voice: false } }));
    vi.stubGlobal('fetch', fetcher);
    await store.getState().save({ voice: false });
    expect(fetcher).toHaveBeenCalledWith('/api/auth/preferences', expect.objectContaining({ body: JSON.stringify({ voice: false }) }));
    expect(sound.getState().voice).toBe(false);
    store.getState().hydrate({ id: 'b', username: 'B' });
    expect(sound.getState()).toMatchObject({ muted: false, voice: false, volume: 0.7, voiceVolume: 0.7, notify: false });
  });

  it('rolls audio preferences back if the server rejects the update', async () => {
    const { store } = await harness();
    const { useSoundStore: sound } = await import('./sound');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    await store.getState().save({ voice: true, volume: 0.2 });
    expect(sound.getState()).toMatchObject({ voice: false, volume: 0.7 });
    expect(store.getState().error).toBe(true);
  });

  it('saves only the changed field and applies server values for other fields', async () => {
    const { store, display } = await harness();
    const fetcher = vi.fn(async () => Response.json({ preferences: { locale: 'zh', cardArt: 'furry' } }));
    vi.stubGlobal('fetch', fetcher);
    await store.getState().save({ cardArt: 'furry' });
    expect(fetcher).toHaveBeenCalledWith('/api/auth/preferences', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ cardArt: 'furry' }),
    }));
    expect(display()).toEqual({ locale: 'zh', cardArt: 'furry' });
    expect(store.getState().saving).toBe(false);
  });

  it.each(['network', 'unauthorized', 'server'])('restores previous settings and reports a %s failure', async (failure) => {
    const { store, display } = await harness();
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'network') throw new Error('offline');
      return new Response(null, { status: failure === 'unauthorized' ? 401 : 500 });
    }));
    await store.getState().save({ locale: 'zh', cardArt: 'classic' });
    expect(display()).toEqual({ locale: 'en', cardArt: 'modern' });
    expect(store.getState()).toMatchObject({ saving: false, error: true });
  });

  it('ignores stale session reads and prevents overlapping writes', async () => {
    const { store, display } = await harness();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const before = store.getState().revision;
    const pending = store.getState().save({ locale: 'zh' });
    const during = store.getState().revision;
    store.getState().hydrate({ id: 'a', username: 'A', preferences: { locale: 'en' } }, before);
    await store.getState().save({ cardArt: 'furry' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(display().locale).toBe('zh');
    resolve(Response.json({ preferences: { locale: 'zh', cardArt: 'modern' } }));
    await pending;
    store.getState().hydrate({ id: 'a', username: 'A', preferences: { locale: 'en' } }, during);
    expect(display()).toEqual({ locale: 'zh', cardArt: 'modern' });
  });

  it('ignores an in-flight save after switching accounts and allows local edits when signed out', async () => {
    const { store, display } = await harness();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const pending = store.getState().save({ cardArt: 'furry' });
    store.getState().hydrate({ id: 'b', username: 'B', preferences: { locale: 'en', cardArt: 'classic' } });
    resolve(Response.json({ preferences: { locale: 'zh', cardArt: 'furry' } }));
    await pending;
    expect(display()).toEqual({ locale: 'en', cardArt: 'classic' });
    store.getState().hydrate(null);
    await store.getState().save({ cardArt: 'modern' });
    expect(display().cardArt).toBe('modern');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
