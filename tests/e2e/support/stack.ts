import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATOR_TOKEN, TEST_DATABASE_URL } from './constants.js';

const exec = promisify(execFile);
export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const ownedProject = (project: string) =>
  /^relaydesk-e2e-\d+-[a-f0-9]{8}$/.test(project);
export function requireOwnedProject(project: string) {
  if (!ownedProject(project))
    throw new Error('Refusing to manage a non-E2E Docker project.');
}
export function composeSpec(instance: string) {
  requireOwnedProject(instance);
  const bind = (source: string, target: string) => ({
    type: 'bind',
    source: resolve(repository, source),
    target,
    read_only: true,
  });
  return {
    services: {
      postgres: {
        image:
          'postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280',
        platform: 'linux/arm64',
        environment: {
          POSTGRES_DB: 'postgres',
          POSTGRES_USER: 'lab_admin',
          POSTGRES_PASSWORD: 'e2e-disposable-admin',
          RELAYDESK_DB_PASSWORD: 'aaaaaaaaaaaaaaaa',
          N8N_DB_PASSWORD: 'bbbbbbbbbbbbbbbb',
        },
        volumes: [
          'postgres_data:/var/lib/postgresql',
          bind('docker/postgres/init', '/docker-entrypoint-initdb.d'),
        ],
        healthcheck: {
          test: ['CMD-SHELL', 'pg_isready -U lab_admin -d postgres'],
          interval: '2s',
          timeout: '3s',
          retries: 40,
        },
      },
      n8n: {
        image:
          'docker.n8n.io/n8nio/n8n:2.38.7@sha256:a8c95f75c6fdf65f5f2b7a7b354744eaa1c62bb911b5c00af6499c3f38e4cd32',
        platform: 'linux/arm64',
        depends_on: { postgres: { condition: 'service_healthy' } },
        environment: {
          DB_TYPE: 'postgresdb',
          DB_POSTGRESDB_HOST: 'postgres',
          DB_POSTGRESDB_PORT: '5432',
          DB_POSTGRESDB_DATABASE: 'n8n',
          DB_POSTGRESDB_USER: 'n8n',
          DB_POSTGRESDB_PASSWORD: 'bbbbbbbbbbbbbbbb',
          N8N_ENCRYPTION_KEY: 'e2e-disposable-encryption-key-not-for-real-data',
          N8N_HOST: 'n8n',
          N8N_PORT: '5678',
          N8N_PROTOCOL: 'http',
          N8N_SECURE_COOKIE: 'false',
          N8N_DIAGNOSTICS_ENABLED: 'false',
          N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
          N8N_TEMPLATES_ENABLED: 'false',
          N8N_PERSONALIZATION_ENABLED: 'false',
          N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
          N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
          N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
          N8N_UNVERIFIED_PACKAGES_ENABLED: 'false',
          N8N_NODES_EXCLUDE:
            '["n8n-nodes-base.executeCommand","n8n-nodes-base.readWriteFile"]',
          GENERIC_TIMEZONE: 'UTC',
          TZ: 'UTC',
        },
        volumes: ['n8n_data:/home/node/.n8n'],
        healthcheck: {
          test: [
            'CMD',
            'node',
            '-e',
            "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ],
          interval: '2s',
          timeout: '3s',
          retries: 90,
        },
      },
      api: {
        image:
          'node:24.21.0-bookworm@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0',
        platform: 'linux/arm64',
        working_dir: '/workspace',
        depends_on: {
          postgres: { condition: 'service_healthy' },
          n8n: { condition: 'service_healthy' },
        },
        environment: {
          RELAYDESK_E2E: '1',
          RELAYDESK_E2E_INSTANCE: instance,
          DATABASE_URL: TEST_DATABASE_URL,
          LAB_AI_MODE: 'fixture',
          CI: 'true',
        },
        // Deliberately NOT a whole-repository/home mount: .env and .local credentials stay outside.
        volumes: [
          ...[
            'package.json',
            'pnpm-lock.yaml',
            'pnpm-workspace.yaml',
            'tsconfig.json',
          ].map((file) => bind(file, `/workspace/${file}`)),
          ...['apps', 'packages', 'fixtures', 'tests/e2e/support'].map(
            (directory) => bind(directory, `/workspace/${directory}`),
          ),
          'api_modules:/workspace/node_modules',
        ],
        command: [
          'sh',
          '-c',
          'corepack pnpm install --frozen-lockfile --ignore-scripts --store-dir=/tmp/pnpm-store && corepack pnpm exec tsx tests/e2e/support/server.ts',
        ],
        ports: ['127.0.0.1::3001'],
        healthcheck: {
          test: [
            'CMD',
            'node',
            '-e',
            "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ],
          interval: '2s',
          timeout: '3s',
          retries: 150,
        },
      },
    },
    volumes: { postgres_data: {}, n8n_data: {}, api_modules: {} },
  };
}

export async function startStack() {
  const instance = `relaydesk-e2e-${process.pid}-${randomBytes(4).toString('hex')}`;
  const directory = await mkdtemp(join(tmpdir(), 'relaydesk-e2e-'));
  const config = join(directory, 'compose.json');
  const envFile = join(directory, 'empty.env');
  await writeFile(config, JSON.stringify(composeSpec(instance), null, 2));
  await writeFile(envFile, '');
  const compose = async (...args: string[]) => {
    requireOwnedProject(instance);
    return exec(
      'docker',
      ['compose', '--env-file', envFile, '-p', instance, '-f', config, ...args],
      { cwd: directory, timeout: 360_000, maxBuffer: 2 * 1024 * 1024 },
    );
  };
  const stop = async () => {
    requireOwnedProject(instance);
    await compose('down', '--volumes', '--remove-orphans', '--timeout', '10');
    if (!basename(directory).startsWith('relaydesk-e2e-'))
      throw new Error('Refusing unowned temporary-directory cleanup.');
    await rm(directory, { recursive: true, force: true });
    console.log(
      `Removed disposable E2E stack ${instance}. Existing lab data was not touched.`,
    );
  };
  try {
    console.log(
      `Starting isolated E2E stack ${instance} (first boot downloads dependencies).`,
    );
    await compose(
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '240',
      'postgres',
      'n8n',
    );
    const definitions = join(directory, 'workflows');
    await mkdir(definitions);
    for (const name of [
      'triage-decision',
      'action-verification',
      'wait-resume-exercise',
    ]) {
      const original = await readFile(
        join(repository, 'workflows', 'definitions', `${name}.json`),
        'utf8',
      );
      // Only relocate the API origin. Workflow nodes, routing, retries and auth remain unchanged.
      const workflow = original.replaceAll(
        'http://host.docker.internal:3001',
        'http://api:3001',
      );
      if (workflow === original)
        throw new Error(
          `No known API origin in ${name}; review the test adapter.`,
        );
      await writeFile(join(definitions, `${name}.json`), workflow);
    }
    await compose('exec', '-T', 'n8n', 'mkdir', '-p', '/tmp/e2e-workflows');
    for (const name of [
      'triage-decision',
      'action-verification',
      'wait-resume-exercise',
    ])
      await compose(
        'cp',
        join(definitions, `${name}.json`),
        `n8n:/tmp/e2e-workflows/${name}.json`,
      );
    await compose(
      'exec',
      '-T',
      'n8n',
      'n8n',
      'import:workflow',
      '--separate',
      '--input=/tmp/e2e-workflows',
    );
    for (const id of [
      'relaydeskTriage',
      'relaydeskAction',
      'relaydeskWaitResume',
    ])
      await compose(
        'exec',
        '-T',
        'n8n',
        'n8n',
        'publish:workflow',
        `--id=${id}`,
      );
    await compose('restart', 'n8n');
    await compose('up', '-d', '--wait', '--wait-timeout', '300', 'api');
    const { stdout } = await compose('port', 'api', '3001');
    const address = stdout.trim();
    if (!/^127\.0\.0\.1:\d+$/.test(address))
      throw new Error('E2E API must have a loopback-only dynamic port.');
    const baseURL = `http://${address}`;
    const response = await fetch(`${baseURL}/__e2e/identity`, {
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    const identity = (await response.json()) as {
      instance: string;
      mode: string;
    };
    if (
      !response.ok ||
      identity.instance !== instance ||
      identity.mode !== 'FIXTURE MODE'
    )
      throw new Error('E2E stack identity mismatch.');
    return { baseURL, instance, stop };
  } catch (error) {
    // These containers contain synthetic data and public disposable tokens only.
    const logs = await compose('logs', '--no-color', '--tail', '50').catch(
      () => ({ stdout: '' }),
    );
    console.error(logs.stdout);
    await stop().catch((cleanupError: unknown) =>
      console.error('E2E cleanup failed:', cleanupError),
    );
    throw error;
  }
}
