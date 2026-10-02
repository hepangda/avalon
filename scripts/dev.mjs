import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { devNull } from 'node:os';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';
import concurrently from 'concurrently';
import { createDevEnv } from './dev-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = {};
for (const filename of ['.env.local']) {
  const path = join(root, filename);
  if (existsSync(path)) Object.assign(local, parse(readFileSync(path)));
}
const env = createDevEnv(process.env, local);
const mode = process.argv[2];
if (mode && !['--db-only', '--db-down', '--server-only'].includes(mode)) {
  throw new Error('Unknown development command');
}
function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '--env-file', devNull, '-f', 'compose.dev.yaml', '-p', 'avalon-dev', ...args], {
      cwd: root, env, stdio: 'inherit',
    });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const cleanup = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };
    child.once('error', () => { cleanup(); reject(new Error('Docker is unavailable. Start Docker Desktop, then run npm run dev again.')); });
    child.once('exit', code => {
      cleanup();
      if (code === 0) resolve();
      else reject(new Error('Local PostgreSQL command failed. Check Docker Desktop and the local database port.'));
    });
  });
}
try {
  if (mode === '--db-down') {
    await docker(['down']); // Preserve the named data volume.
  } else {
    await docker(['up', '-d', '--wait', '--wait-timeout', '60', 'db']);
    console.log(`[dev] Local PostgreSQL: 127.0.0.1:${env.AVALON_DEV_DB_PORT}/avalon_development`);
    if (mode !== '--db-only') {
      const commands = [{ name: 'api', command: 'tsx watch server/index.ts', env }];
      if (mode !== '--server-only') commands.push({ name: 'web', command: 'vite --host localhost --port 5173 --strictPort', env });
      await concurrently(commands, { cwd: root, prefix: 'name', killOthersOn: ['failure', 'success'], killSignal: 'SIGTERM' }).result;
    }
  }
} catch (error) {
  if (error instanceof Error) console.error(`[dev] ${error.message}`);
  process.exitCode = 1;
}
