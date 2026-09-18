import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { connect } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';

const envPath = new URL('../.env', import.meta.url);

function parseEnv(text: string) {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Invalid .env line: ${rawLine}`);
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function loadOrCreateEnv(): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(envPath, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const relaydeskPassword = randomBytes(24).toString('hex');
    const values = {
      POSTGRES_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
      RELAYDESK_DB_PASSWORD: relaydeskPassword,
      N8N_DB_PASSWORD: randomBytes(24).toString('hex'),
      N8N_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      LAB_OPERATOR_TOKEN: randomBytes(32).toString('hex'),
      N8N_WEBHOOK_TOKEN: randomBytes(32).toString('hex'),
      POSTGRES_PORT: '55432',
      N8N_PORT: '5678',
      DATABASE_URL: `postgresql://relaydesk:${relaydeskPassword}@127.0.0.1:55432/relaydesk`,
    };
    const text = `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
    await writeFile(envPath, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log('Created private .env with generated local-only secrets.');
    return values;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd: new URL('..', import.meta.url), env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
}

const localEnv = await loadOrCreateEnv();
if (!localEnv.N8N_WEBHOOK_TOKEN) {
  localEnv.N8N_WEBHOOK_TOKEN = randomBytes(32).toString('hex');
  await writeFile(envPath, `N8N_WEBHOOK_TOKEN=${localEnv.N8N_WEBHOOK_TOKEN}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' });
  console.log('Added a separate n8n automation token to the existing private .env.');
}
const env = { ...process.env, ...localEnv };
for (const required of ['DATABASE_URL', 'LAB_OPERATOR_TOKEN', 'N8N_WEBHOOK_TOKEN', 'POSTGRES_ADMIN_PASSWORD', 'RELAYDESK_DB_PASSWORD', 'N8N_DB_PASSWORD', 'N8N_ENCRYPTION_KEY']) {
  if (!env[required]) throw new Error(`${required} is required in .env`);
}

run('docker', ['compose', '--env-file', '.env', 'up', '-d', '--wait', 'postgres', 'n8n'], env);

const { db, pool } = connect(env.DATABASE_URL!);
try {
  await migrate(pool);
  await seed(db);
} finally {
  await pool.end();
}

run('docker', [
  'compose', '--env-file', '.env', 'exec', '-T', 'n8n', 'n8n', 'import:workflow',
  '--separate', '--input=/workflows/definitions',
], env);
run('docker', ['compose', '--env-file', '.env', 'exec', '-T', 'n8n', 'n8n', 'publish:workflow', '--id=relaydeskTriage'], env);
run('docker', ['compose', '--env-file', '.env', 'exec', '-T', 'n8n', 'n8n', 'publish:workflow', '--id=relaydeskAction'], env);
run('docker', ['compose', '--env-file', '.env', 'exec', '-T', 'n8n', 'n8n', 'publish:workflow', '--id=relaydeskWaitResume'], env);
run('docker', ['compose', '--env-file', '.env', 'restart', 'n8n'], env);
run('docker', ['compose', '--env-file', '.env', 'up', '-d', '--wait', 'n8n'], env);

console.log('RelayDesk infrastructure is healthy, fixtures are seeded, and reviewed workflows are imported.');
