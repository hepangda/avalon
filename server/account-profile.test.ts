import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';

// OIDC cryptographic verification is outside these profile tests. The application
// session is still a real encrypted cookie and is handled by the real auth flow.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(async (token: string) => ({
    payload: { sub: token.replace(/^(access|id)-/, ''), token_use: 'access_token' },
  })),
}));

import app from './app';
import { MemoryPersistence } from './test-persistence';
import { accountKey, accountProfile } from './account-profile';
import { authenticateRoomSocket } from './socket-auth';

const origin = 'https://avalon.test';
const issuer = 'https://auth.pangda.app';
const sessionSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  userinfo_endpoint: `${issuer}/userinfo`,
  jwks_uri: `${issuer}/jwks`,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(metadata)),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function harness() {
  const init = vi.fn(async () => ({
    ok: true,
    hostToken: 'host',
    playerId: 'seat',
    playerToken: 'token',
  }));
  const env = {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'avalon',
    OIDC_CLIENT_SECRET: 'test-client-secret',
    OIDC_RESOURCE: 'https://avalon.pangda.app/createRoom',
    OIDC_SESSION_SECRET: sessionSecret,
    ENVIRONMENT: 'production',
    persistence: new MemoryPersistence(),
    rooms: { get: () => ({ init }) },
  } as unknown as Env;
  return { env, init };
}

async function sessionCookie(id = 'user-a', username = 'Original', expired = false) {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const value = {
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    accessTokenExpiresAt: Date.now() + (expired ? -1 : 3600_000),
    user: { id, username, picture: 'https://example.com/avatar.png' },
  };
  const cipher = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode('avalon:oidc-session:v1'),
    },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `avalon_oidc_session=v1.${Buffer.from(iv).toString('base64url')}.${Buffer.from(cipher).toString('base64url')}`;
}

function save(env: Env, cookie: string, body: unknown) {
  return app.request(
    `${origin}/api/auth/alias`,
    {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('account aliases', () => {
  it('persists an alias across logout, new sessions and object eviction without changing the account name', async () => {
    const { env } = harness();
    const cookie = await sessionCookie();
    const saved = await save(env, cookie, { alias: '  圆桌骑士  ' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      user: { id: 'user-a', username: 'Original', alias: '圆桌骑士' },
    });
    await app.request(
      `${origin}/api/auth/logout`,
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    const login = await app.request(
      `${origin}/api/auth/session`,
      {
        headers: { Cookie: await sessionCookie('user-a', 'New IdP name') },
      },
      env,
    );
    expect(await login.json()).toMatchObject({
      user: { username: 'New IdP name', alias: '圆桌骑士' },
    });
    expect(login.headers.get('Cache-Control')).toBe('no-store');
  });

  it('isolates accounts and issuers, ignoring any requested target account', async () => {
    const { env } = harness();
    await save(env, await sessionCookie(), { alias: 'A的名字', id: 'user-b' });
    const other = await app.request(
      `${origin}/api/auth/session`,
      {
        headers: { Cookie: await sessionCookie('user-b') },
      },
      env,
    );
    expect(await other.json()).toEqual({
      user: { id: 'user-b', username: 'Original', preferences: {}, picture: 'https://example.com/avatar.png', rerollCards: { cards: 1, completedGames: 0, lastDailyDay: expect.any(String) } },
    });
    expect(
      await accountProfile(
        { ...env, OIDC_ISSUER: 'https://auth-staging.pangda.app' },
        'user-a',
      ).getAlias(),
    ).toBeNull();
    expect(await accountProfile(env, 'user-a').getAlias()).toBe('A的名字');
  });

  it('keeps the alias when OIDC tokens refresh with a different provider name', async () => {
    const { env } = harness();
    await save(env, await sessionCookie(), { alias: '不变的别名' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/token'))
          return Response.json({
            access_token: 'access-user-a',
            refresh_token: 'refresh-user-a',
            id_token: 'id-user-a',
            token_type: 'Bearer',
            expires_in: 3600,
          });
        if (url.endsWith('/userinfo'))
          return Response.json({ sub: 'user-a', preferred_username: 'Refreshed name' });
        return Response.json(metadata);
      }),
    );
    const refreshed = await app.request(
      `${origin}/api/auth/session`,
      {
        headers: { Cookie: await sessionCookie('user-a', 'Original', true) },
      },
      env,
    );
    expect(await refreshed.json()).toMatchObject({
      user: { username: 'Refreshed name', alias: '不变的别名' },
    });
    expect(refreshed.headers.get('Set-Cookie')).toContain('avalon_oidc_session=');
    const socketSession = await authenticateRoomSocket(
      origin, await sessionCookie('user-a', 'Original', true), env,
    );
    expect(socketSession.account).toBe(accountKey(issuer, 'user-a'));
    expect(socketSession.cookies.some((cookie) => cookie.startsWith('avalon_oidc_session='))).toBe(true);
  });

  it('uses the saved alias and account avatar when creating a room', async () => {
    const { env, init } = harness();
    const cookie = await sessionCookie();
    await save(env, cookie, { alias: '新队长' });
    const response = await app.request(
      `${origin}/api/rooms`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster: [] }),
      },
      env,
    );
    expect(response.status).toBe(201);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        creator: {
          name: '新队长', avatarUrl: 'https://example.com/avatar.png',
          account: accountKey(issuer, 'user-a'),
        },
      }),
    );
  });

  it.each([{}, { alias: '' }, { alias: ' \n ' }, { alias: 42 }, null])(
    'rejects invalid aliases without replacing a saved value: %j',
    async (body) => {
      const { env } = harness();
      const cookie = await sessionCookie();
      await save(env, cookie, { alias: '原别名' });
      expect((await save(env, cookie, body)).status).toBe(400);
      expect(await accountProfile(env, 'user-a').getAlias()).toBe('原别名');
    },
  );

  it('enforces the shared ten-character limit and supports Unicode names', async () => {
    const { env } = harness();
    const response = await save(env, await sessionCookie(), { alias: '😀'.repeat(12) });
    expect(await response.json()).toMatchObject({ user: { alias: '😀'.repeat(10) } });
  });

  it('requires an authenticated same-origin JSON request', async () => {
    const { env } = harness();
    expect((await save(env, '', { alias: '无效' })).status).toBe(401);
    const cookie = await sessionCookie();
    for (const [requestOrigin, contentType, expected] of [
      ['https://attacker.example', 'application/json', 403],
      [origin, 'text/plain', 400],
    ] as const) {
      const response = await app.request(
        `${origin}/api/auth/alias`,
        {
          method: 'POST',
          headers: { Cookie: cookie, Origin: requestOrigin, 'Content-Type': contentType },
          body: JSON.stringify({ alias: '无效' }),
        },
        env,
      );
      expect(response.status).toBe(expected);
    }
    expect(await accountProfile(env, 'user-a').getAlias()).toBeNull();
  });
});

describe('account display preferences', () => {
  function update(env: Env, cookie: string, body: unknown, requestOrigin = origin, contentType = 'application/json') {
    return app.request(`${origin}/api/auth/preferences`, {
      method: 'PATCH',
      headers: { Cookie: cookie, Origin: requestOrigin, 'Content-Type': contentType },
      body: JSON.stringify(body),
    }, env);
  }

  it('loads saved settings in a fresh login and preserves independent edits and aliases', async () => {
    const { env } = harness();
    const cookie = await sessionCookie();
    await save(env, cookie, { alias: 'Knight' });
    const first = await update(env, cookie, { locale: 'en', cardArt: 'modern' });
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(await first.json()).toEqual({ preferences: { locale: 'en', cardArt: 'modern' } });
    const second = await update(env, await sessionCookie(), { cardArt: 'furry' });
    expect(await second.json()).toEqual({ preferences: { locale: 'en', cardArt: 'furry' } });
    const session = await app.request(`${origin}/api/auth/session`, {
      headers: { Cookie: await sessionCookie('user-a', 'Another device') },
    }, env);
    expect(await session.json()).toMatchObject({ user: {
      alias: 'Knight', preferences: { locale: 'en', cardArt: 'furry' },
    } });
    expect(await accountProfile(env, 'user-b').getPreferences()).toEqual({});
    expect(await accountProfile({ ...env, OIDC_ISSUER: 'https://auth-staging.pangda.app' }, 'user-a').getPreferences()).toEqual({});
  });

  it.each([null, [], {}, { locale: 'fr' }, { cardArt: 'unknown' }, { locale: 3 },
    { cardArt: null }, { locale: 'en', id: 'user-b' }, { alias: 'not a preference' }])(
    'rejects invalid preference updates without replacing saved values: %j', async (body) => {
      const { env } = harness();
      const cookie = await sessionCookie();
      await update(env, cookie, { cardArt: 'modern' });
      expect((await update(env, cookie, body)).status).toBe(400);
      expect(await accountProfile(env, 'user-a').getPreferences()).toEqual({ cardArt: 'modern' });
    },
  );

  it('requires an authenticated same-origin JSON write', async () => {
    const { env } = harness();
    const cookie = await sessionCookie();
    expect((await update(env, '', { locale: 'en' })).status).toBe(401);
    expect((await update(env, cookie, { locale: 'en' }, 'https://elsewhere.test')).status).toBe(403);
    expect((await update(env, cookie, { locale: 'en' }, origin, 'text/plain')).status).toBe(400);
    expect(await accountProfile(env, 'user-a').getPreferences()).toEqual({});
  });
});

describe('daily reroll card session claims', () => {
  it('grants once across repeated requests and again at 04:00 UTC+8', async () => {
    const { env } = harness();
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T19:59:59.999Z'));
    const cookie = await sessionCookie();
    const read = async () => (await app.request(`${origin}/api/auth/session`, { headers: { Cookie: cookie } }, env)).json();
    expect(await read()).toMatchObject({ user: { rerollCards: { cards: 1, lastDailyDay: '2026-09-29' } } });
    expect(await read()).toMatchObject({ user: { rerollCards: { cards: 1 } } });
    now.mockReturnValue(Date.parse('2026-09-29T20:00:00.000Z'));
    expect(await read()).toMatchObject({ user: { rerollCards: { cards: 2, lastDailyDay: '2026-09-30' } } });
    const signedOut = await app.request(`${origin}/api/auth/session`, {}, env);
    expect(await signedOut.json()).toEqual({ user: null });
  });
});

describe('account-only room access', () => {
  it.each(['', 'avalon_oidc_session=invalid'])(
    'rejects HTTP room access and WebSocket authentication with an absent or invalid session (%s)',
    async (cookie) => {
      const { env, init } = harness();
      const loadReplay = vi.spyOn(env.persistence, 'loadReplay');
      for (const [path, method] of [
        ['/api/rooms', 'POST'],
        ['/api/rooms/1234', 'GET'],
        ['/api/games/game-1/replay', 'GET'],
      ]) {
        const response = await app.request(`${origin}${path}`, {
          method, headers: { Cookie: cookie },
        }, env);
        expect(response.status).toBe(401);
      }
      await expect(authenticateRoomSocket(origin, cookie, env)).rejects.toMatchObject({
        code: 'AUTH_REQUIRED', status: 401,
      });
      expect(init).not.toHaveBeenCalled();
      expect(loadReplay).not.toHaveBeenCalled();
    },
  );

  it('allows signed-in previews, replay lookup and verified socket accounts', async () => {
    const { env } = harness();
    const cookie = await sessionCookie();
    const preview = vi.fn(async () => ({ code: '1234', playerCount: 5, status: 'lobby' }));
    vi.spyOn(env.rooms, 'get').mockReturnValue({ preview } as unknown as ReturnType<Env['rooms']['get']>);
    const loadReplay = vi.spyOn(env.persistence, 'loadReplay');
    const response = await app.request(`${origin}/api/rooms/1234`, { headers: { Cookie: cookie } }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ code: '1234' });
    expect((await app.request(`${origin}/api/games/game-1/replay`, { headers: { Cookie: cookie } }, env)).status).toBe(404);
    expect(loadReplay).toHaveBeenCalledWith('game-1');
    expect(await authenticateRoomSocket(origin, cookie, env)).toEqual({
      account: accountKey(issuer, 'user-a'), cookies: [],
    });
  });

  it('rejects an expired session when its refresh is denied', async () => {
    const { env } = harness();
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).endsWith('/token')
        ? Response.json({ error: 'invalid_grant' }, { status: 400 })
        : Response.json(metadata),
    );
    await expect(authenticateRoomSocket(origin, await sessionCookie('user-a', 'Original', true), env))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
  });
});

describe('local debug card grant', () => {
  it('grants exactly one card per visit to the authenticated account, capped at two', async () => {
    const { env } = harness();
    env.ENVIRONMENT = 'development';
    const cookie = await sessionCookie();
    const wallet = accountProfile(env, 'user-a');
    expect((await wallet.getCards()).cards).toBe(0);
    for (const count of [1, 2, 2]) {
      const response = await app.request('http://localhost:5173/debug/addRandomCard?account=user-b', {
        headers: { Cookie: cookie, 'Sec-Fetch-Site': 'none' },
      }, env);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ rerollCards: { cards: count, completedGames: 0, lastDailyDay: null } });
    }
    expect((await accountProfile(env, 'user-b').getCards()).cards).toBe(0);
  });

  it.each([
    ['production', 'http://localhost:5173'],
    [undefined, 'http://localhost:5173'],
    ['development', 'https://avalon.pangda.app'],
    ['development', 'http://localhost.evil.test'],
  ])('is absent outside explicit local development (%s, %s)', async (environment, base) => {
    const { env } = harness();
    env.ENVIRONMENT = environment;
    const grant = vi.spyOn(env.persistence, 'grantDebugCard');
    const response = await app.request(`${base}/debug/addRandomCard`, {
      headers: { Cookie: await sessionCookie() },
    }, env);
    expect(response.status).toBe(404);
    expect(grant).not.toHaveBeenCalled();
  });

  it('requires login and rejects cross-site requests without granting cards', async () => {
    const { env } = harness();
    env.ENVIRONMENT = 'development';
    const path = 'http://localhost:5173/debug/addRandomCard';
    expect((await app.request(path, {}, env)).status).toBe(401);
    const cookie = await sessionCookie();
    expect((await app.request(path, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } }, env)).status).toBe(403);
    expect((await app.request(path, { headers: { Cookie: cookie, Origin: 'https://elsewhere.test' } }, env)).status).toBe(403);
    expect((await accountProfile(env, 'user-a').getCards()).cards).toBe(0);
  });
});
