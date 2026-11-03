import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('removes legacy local identities while preserving room reconnect credentials', async () => {
  const sessions = { '1234': { playerId: 'seat', playerToken: 'token', hostToken: 'host' } };
  const storage = new Map([['avalon-session', JSON.stringify({
    version: 0,
    state: { sessions, lastName: 'Old guest', lastAvatarUrl: 'https://example.com/old.png' },
  })]]);
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  vi.stubGlobal('window', { localStorage });
  const { useSessionStore } = await import('./session');
  expect(useSessionStore.getState().getSession('1234')).toEqual(sessions['1234']);
  expect(useSessionStore.getState()).not.toHaveProperty('lastName');
  expect(useSessionStore.getState()).not.toHaveProperty('lastAvatarUrl');
  expect(JSON.parse(storage.get('avalon-session')!)).toEqual({ version: 1, state: { sessions } });
});
