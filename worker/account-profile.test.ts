import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Env,
    ) {}
  },
}));
// OIDC cryptographic verification is outside these profile tests. The application
// session is still a real encrypted cookie and is handled by the real auth flow.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(async (token: string) => ({
    payload: { sub: token.replace(/^(access|id)-/, ''), token_use: 'access_token' },
  })),
}));

import app from './index';
import { AccountProfileDurableObject } from './account-profile-do';
import { accountProfile } from './account-profile';

const databases: DatabaseSync[] = [];
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
  for (const db of databases.splice(0)) db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function harness() {
  const profiles = new Map<string, DatabaseSync>();
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
    ACCOUNT_PROFILE: {
      idFromName: (name: string) => name,
      get: (id: string) => {
        let db = profiles.get(id);
        if (!db) {
          db = new DatabaseSync(':memory:');
          profiles.set(id, db);
          databases.push(db);
        }
        const storage = db;
        const ctx = {
          storage: {
            sql: {
              exec: (query: string, ...bindings: Array<string | number>) => {
                const rows = storage.prepare(query).all(...bindings);
                return { toArray: () => rows };
              },
            },
          },
        } as unknown as DurableObjectState;
        // Reconstruct for every access: values must survive object eviction.
        return new AccountProfileDurableObject(ctx, env);
      },
    },
    ROOM: { idFromName: (name: string) => name, get: () => ({ init }) },
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
      user: { id: 'user-b', username: 'Original', picture: 'https://example.com/avatar.png' },
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
        creator: { name: '新队长', avatarUrl: 'https://example.com/avatar.png' },
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
