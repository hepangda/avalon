import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devNull } from 'node:os';
import { createDevEnv } from './dev-env.mjs';

test('production shell and local DATABASE_URL values cannot redirect development to Neon', () => {
  const env = createDevEnv({ DATABASE_URL: 'postgres://user:secret@production.neon.tech/main',
    NODE_ENV: 'production', ENVIRONMENT: 'production', PUBLIC_ORIGIN: 'https://avalon.pangda.app',
    DOTENV_CONFIG_PATH: '.env.neon', DOTENV_CONFIG_OVERRIDE: 'true',
    PGSSLMODE: 'verify-full', PGOPTIONS: 'endpoint=production' }, {
    DATABASE_URL: 'postgres://user:secret@other.neon.tech/main',
    OIDC_CLIENT_ID: 'avalon_local',
  });
  const database = new URL(env.DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.pathname, '/avalon_development');
  assert.equal(database.port, '55432');
  assert.equal(env.PUBLIC_ORIGIN, 'http://localhost:5173');
  assert.equal(env.ENVIRONMENT, 'development');
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.DOTENV_CONFIG_PATH, devNull);
  assert.equal(env.PGSSLMODE, 'disable');
  assert.equal(env.PGOPTIONS, '');
  assert.equal(env.OIDC_CLIENT_ID, 'avalon_local');
});

test('local port overrides affect both the container and backend without changing the host', () => {
  const env = createDevEnv({}, { AVALON_DEV_DB_PORT: '55433' });
  assert.equal(new URL(env.DATABASE_URL).port, env.AVALON_DEV_DB_PORT);
  for (const port of ['0', '99999', 'neon.tech', '5432;echo test']) {
    assert.throws(() => createDevEnv({}, { AVALON_DEV_DB_PORT: port }), /AVALON_DEV_DB_PORT/);
  }
});
