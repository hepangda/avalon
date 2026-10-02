import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_ART_STYLES } from '@/lib/preferences';
import { createImagePreloader, gameImageUrls } from './preloadImages';

class FakeImage {
  static instances: FakeImage[] = [];
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removeAttribute = vi.fn();
  constructor() { FakeImage.instances.push(this); }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('room image inventory', () => {
  it.each(CARD_ART_STYLES)('covers every game image, prioritizing %s artwork', (style) => {
    const files = readdirSync('public/assets/game', { recursive: true })
      .map(String)
      .filter((file) => /\.(webp|png|jpe?g|avif|svg)$/.test(file))
      .map((file) => `/assets/game/${file}`);
    const urls = gameImageUrls(style);
    expect([...urls].sort()).toEqual(files.sort());
    const roles = urls.filter((url) => url.includes('/roles/'));
    const firstOther = roles.findIndex((url) => !url.includes(`/roles/${style}/`));
    expect(firstOther).toBeGreaterThan(0);
    expect(roles.slice(firstOther).every((url) => !url.includes(`/roles/${style}/`))).toBe(true);
  });

  it('uses the same content-hashed CDN URLs as rendered images', () => {
    const path = '/assets/game/roles/modern/cards/merlin.webp';
    const cdn = 'https://static.example.com/avalon/assets/public/hash/merlin.webp';
    vi.stubGlobal('__PUBLIC_ASSET_URLS__', { [path]: cdn });
    expect(gameImageUrls('modern')).toContain(cdn);
    expect(gameImageUrls('modern')).not.toContain(path);
  });
});

describe('background image loading', () => {
  it('caps concurrency, deduplicates pending work and retains completed images across navigation', () => {
    const preload = createImagePreloader();
    const urls = ['a', 'b', 'c', 'd', 'e', 'f'];
    preload(urls);
    preload(urls);
    expect(FakeImage.instances.map((image) => image.src)).toEqual(urls.slice(0, 4));
    FakeImage.instances[0]!.onload!();
    expect(FakeImage.instances.map((image) => image.src)).toEqual(urls.slice(0, 5));
    // Completing one request starts the next queued request.
    for (let i = 1; i < FakeImage.instances.length; i++) FakeImage.instances[i]!.onload!();
    preload(urls);
    expect(FakeImage.instances).toHaveLength(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries failures behind queued work and allows a later retry after recovery', () => {
    const preload = createImagePreloader();
    preload(['broken', 'b', 'c', 'd', 'e']);
    FakeImage.instances[0]!.onerror!();
    expect(FakeImage.instances[4]!.src).toBe('e');
    FakeImage.instances[1]!.onload!();
    expect(FakeImage.instances[5]!.src).toBe('broken');
    FakeImage.instances[5]!.onerror!();
    expect(FakeImage.instances).toHaveLength(6);
    preload(['broken', 'b']);
    expect(FakeImage.instances.map((image) => image.src)).toEqual(['broken', 'b', 'c', 'd', 'e', 'broken', 'broken']);
  });

  it('releases stalled requests so other images can still load, with bounded retries', () => {
    const preload = createImagePreloader();
    preload(['stalled', 'b', 'c', 'd', 'e']);
    vi.advanceTimersByTime(30_000);
    expect(FakeImage.instances[0]!.removeAttribute).toHaveBeenCalledWith('src');
    expect(FakeImage.instances.some((image) => image.src === 'e')).toBe(true);
    vi.runAllTimers();
    expect(FakeImage.instances).toHaveLength(10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing outside a browser', () => {
    vi.stubGlobal('Image', undefined);
    expect(() => createImagePreloader()(['a'])).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
