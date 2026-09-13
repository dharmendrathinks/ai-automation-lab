import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';

// Always creates its own cluster. Never accepts an existing database URL.
const directory = await mkdtemp(join(tmpdir(), 'relaydesk-pg-'));
const binaries = process.env.LAB_PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No available port');
const port = address.port;
await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
function run(binary: string, args: string[]) {
  const result = spawnSync(join(binaries, binary), args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.error?.message ?? result.stderr}`);
}
let started = false;
try {
  run('initdb', ['-D', join(directory, 'data'), '--auth=trust', '--username=lab', '--encoding=UTF8', '--no-locale']);
  run('pg_ctl', ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start']);
  started = true;
  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: `postgresql://lab@127.0.0.1:${port}/postgres` },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (started) run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
