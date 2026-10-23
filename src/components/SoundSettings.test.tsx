// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SoundSettings } from './SoundSettings';
import { useAccountPreferencesStore } from '@/lib/store/accountPreferences';
import { useSoundStore } from '@/lib/store/sound';
vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
vi.mock('use-intl', () => ({ useLocale: () => 'zh', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/audio/engine', () => ({ playSound: vi.fn() }));
vi.mock('@/lib/audio/useGameVoice', () => ({ previewVoice: vi.fn() }));

it('saves channel switches and the completed slider value to the account', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => Response.json({ preferences: JSON.parse(init.body as string) }));
  vi.stubGlobal('fetch', fetcher);
  useAccountPreferencesStore.getState().hydrate({ id: 'audio-user', username: 'Player' });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SoundSettings />));
    const voice = container.querySelector<HTMLButtonElement>('button[aria-label="voice"]')!;
    expect(voice.getAttribute('aria-pressed')).toBe('false');
    await act(async () => voice.click());
    expect(fetcher.mock.calls[0]?.[1].body).toBe(JSON.stringify({ voice: true }));
    expect(useSoundStore.getState().voice).toBe(true);
    const slider = container.querySelector<HTMLInputElement>('input[aria-label="effects"]')!;
    // Native value setter lets React observe the input event as a user edit.
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '35');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(fetcher.mock.calls[1]?.[1].body).toBe(JSON.stringify({ volume: 0.35, muted: false }));
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
