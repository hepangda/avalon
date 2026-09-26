import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('anonymous Flagship identity', () => {
  it('keeps the same ID across evaluations and page reloads', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const { anonymousIdentityId } = await import('./anonymousIdentity');
    const id = anonymousIdentityId();
    expect(anonymousIdentityId()).toBe(id);
    vi.resetModules();
    expect((await import('./anonymousIdentity')).anonymousIdentityId()).toBe(id);
  });

  it('keeps an in-memory identity when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    const { anonymousIdentityId } = await import('./anonymousIdentity');
    const id = anonymousIdentityId();
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(anonymousIdentityId()).toBe(id);
  });
});
