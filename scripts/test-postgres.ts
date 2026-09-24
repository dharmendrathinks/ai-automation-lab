import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// The default must also run on Linux CI and clean contributor machines.
// Use the same pinned ARM64 PostgreSQL as the lab, with no host data mounts.
if (!process.env.LAB_PG_BIN) {
  const container = `relaydesk-pg-test-${randomUUID()}`;
  const image =
    'postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280';
  const docker = (args: string[]) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.status !== 0)
      throw new Error(
        `Disposable PostgreSQL command failed: ${result.error?.message ?? result.stderr}`,
      );
    return result.stdout.trim();
  };
  let created = false;
  let status = 1;
  try {
    docker([
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      '--platform',
      'linux/arm64',
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_USER=lab',
      '-e',
      'POSTGRES_PASSWORD=disposable-test-only',
      '-e',
      'POSTGRES_DB=postgres',
      image,
    ]);
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const check = spawnSync(
        'docker',
        [
          'exec', container, 'pg_isready', '-h', '127.0.0.1',
          '-U', 'lab', '-d', 'postgres',
        ],
        { encoding: 'utf8', timeout: 5_000 },
      );
      if (check.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready.');
    const binding = docker(['port', container, '5432/tcp']);
    if (!/^127\.0\.0\.1:\d+$/.test(binding))
      throw new Error('Unexpected PostgreSQL test port binding.');
    const result = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TEST_DATABASE_URL: `postgresql://lab:disposable-test-only@${binding}/postgres`,
        },
      },
    );
    status = result.status ?? 1;
  } finally {
    if (created) docker(['rm', '-f', '-v', container]);
  }
  process.exit(status);
}

// Always creates its own cluster. Never accepts an existing database URL.
const directory = await mkdtemp(join(tmpdir(), 'relaydesk-pg-'));
const binaries = process.env.LAB_PG_BIN;
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('No available port');
const port = address.port;
await new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
);
function run(binary: string, args: string[]) {
  const result = spawnSync(join(binaries, binary), args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(
      `${binary} failed: ${result.error?.message ?? result.stderr}`,
    );
}
let started = false;
try {
  run('initdb', [
    '-D',
    join(directory, 'data'),
    '--auth=trust',
    '--username=lab',
    '--encoding=UTF8',
    '--no-locale',
  ]);
  run('pg_ctl', [
    '-D',
    join(directory, 'data'),
    '-l',
    join(directory, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -k ${directory}`,
    '-w',
    'start',
  ]);
  started = true;
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_DATABASE_URL: `postgresql://lab@127.0.0.1:${port}/postgres`,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (started)
    run('pg_ctl', [
      '-D',
      join(directory, 'data'),
      '-m',
      'immediate',
      '-w',
      'stop',
    ]);
  await rm(directory, { recursive: true, force: true });
}
