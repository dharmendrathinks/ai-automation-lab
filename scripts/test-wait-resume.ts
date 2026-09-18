import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../apps/api/src/app.js';
import { connect } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';

const { DATABASE_URL, LAB_OPERATOR_TOKEN, N8N_WEBHOOK_TOKEN } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN || !N8N_WEBHOOK_TOKEN) throw new Error('Run after pnpm run setup');
const { db, pool } = connect(DATABASE_URL);
let clock = new Date();
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN, n8nToken: N8N_WEBHOOK_TOKEN, now: () => clock });
const operatorHeaders = { authorization: `Bearer ${LAB_OPERATOR_TOKEN}` };
const webhook = 'http://127.0.0.1:5678/webhook/relaydesk-wait-start';

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch { /* Transient restart/read failures are expected while polling. */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function create(expiresInSeconds = 300) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/wait-exercises', headers: operatorHeaders, payload: { expiresInSeconds } });
  if (response.statusCode !== 201) throw new Error(response.body);
  return response.json<{ id: string }>().id;
}
async function start(id: string) {
  const response = await fetch(webhook, { method: 'POST', headers: { authorization: `Bearer ${N8N_WEBHOOK_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ exerciseId: id }) });
  if (!response.ok) throw new Error(`wait workflow start failed: ${response.status} ${await response.text()}`);
  await eventually(async () => (await pool.query('SELECT resume_url FROM wait_exercises WHERE id=$1', [id])).rows[0]?.resume_url as string | null, Boolean, 'resume URL registration');
}
async function approve(id: string) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/wait-exercises/${id}/approve`, headers: operatorHeaders });
  if (response.statusCode !== 200) throw new Error(`approval failed: ${response.body}`);
}
async function resume(id: string) {
  return app.inject({ method: 'POST', url: `/api/v1/wait-exercises/${id}/resume`, headers: operatorHeaders });
}
async function state(id: string) {
  return (await pool.query('SELECT status, callback_attempts FROM wait_exercises WHERE id=$1', [id])).rows[0] as { status: string; callback_attempts: number };
}

try {
  await migrate(pool);
  await pool.query('TRUNCATE wait_exercises');
  await app.listen({ host: '127.0.0.1', port: 3001 });

  const early = await create();
  await approve(early);
  await start(early);
  if ((await resume(early)).statusCode !== 200) throw new Error('early-approval resume failed');
  await eventually(() => state(early), (value) => value.status === 'completed', 'early approval completion');

  const restarted = await create();
  await start(restarted);
  await approve(restarted);
  const restart = spawnSync('docker', ['compose', '--env-file', '.env', 'restart', 'n8n'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  if (restart.status !== 0) throw new Error(`n8n restart failed: ${restart.stderr}`);
  await eventually(async () => (await fetch('http://127.0.0.1:5678/healthz')).ok, Boolean, 'n8n restart health');
  await eventually(() => resume(restarted), (response) => response.statusCode === 200, 'restart resume retry');
  await eventually(() => state(restarted), (value) => value.status === 'completed', 'post-restart completion');
  const replay = await resume(restarted);
  if (replay.statusCode !== 200 || !replay.json<{ replayed: boolean }>().replayed) throw new Error(`duplicate resume was not harmless: ${replay.body}`);

  const raced = await create();
  await start(raced); await approve(raced);
  await Promise.allSettled([resume(raced), resume(raced)]);
  const racedState = await eventually(() => state(raced), (value) => value.status === 'completed', 'raced callback completion');
  if (racedState.callback_attempts < 1 || racedState.callback_attempts > 2) throw new Error(`unexpected callback attempts: ${JSON.stringify(racedState)}`);

  const expired = await create(1);
  clock = new Date(clock.getTime() + 2_000);
  const lateApproval = await app.inject({ method: 'POST', url: `/api/v1/wait-exercises/${expired}/approve`, headers: operatorHeaders });
  if (lateApproval.statusCode !== 500 || (await state(expired)).status !== 'expired') throw new Error('expired approval was not rejected');

  console.log('Native n8n wait persisted across restart; early approval, callback race, lost-response retry, duplicate callback and expiry behaved safely.');
} finally {
  await app.close(); await pool.end();
}
