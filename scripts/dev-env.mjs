import { devNull } from 'node:os';

/** Dev owns its database and ports; inherited production values cannot select a remote DB. */
export function createDevEnv(inherited, local) {
  const env = { ...inherited, ...local };
  const port = Number(env.AVALON_DEV_DB_PORT ?? 55432);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('AVALON_DEV_DB_PORT must be an integer between 1024 and 65535');
  }
  return {
    ...env,
    // The launcher loads only local configuration. Disable the server's generic .env loader.
    DOTENV_CONFIG_PATH: devNull,
    DOTENV_CONFIG_OVERRIDE: 'false',
    AVALON_DEV_DB_PORT: String(port),
    DATABASE_URL: `postgres://avalon:avalon_dev@127.0.0.1:${port}/avalon_development`,
    PGSSLMODE: 'disable',
    PGOPTIONS: '',
    NODE_ENV: 'development',
    ENVIRONMENT: 'development',
    HOST: '127.0.0.1',
    PORT: '3000',
    PUBLIC_ORIGIN: 'http://localhost:5173',
  };
}
