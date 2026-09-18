import { spawn } from 'node:child_process';
import { buildApp } from '../apps/api/src/app.js';
import { connect } from '../apps/api/src/db/index.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.LAB_OPERATOR_TOKEN) throw new Error('LAB_OPERATOR_TOKEN is required');

const { db, pool } = connect(process.env.DATABASE_URL);
const app = buildApp({ db, token: process.env.LAB_OPERATOR_TOKEN });

try {
  await app.listen({ host: '127.0.0.1', port: 3001 });
  const child = spawn('docker', [
    'compose', '--env-file', '.env', 'run', '--rm', '-e', 'N8N_RUNNERS_ENABLED=false',
    'n8n', 'execute', '--id=relaydeskFoundation', '--rawOutput',
  ]);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('n8n foundation execution exceeded 30 seconds'));
    }, 30_000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });
  if (status !== 0) throw new Error(`n8n execution failed:\n${stderr}${stdout}`);
  if (!stdout.includes('"status": "success"') || !stdout.includes('"mode": "FIXTURE MODE"')) {
    throw new Error(`n8n did not return the expected verified health response:\n${stdout}`);
  }
  console.log('Foundation workflow imported and reached the host API: FIXTURE MODE, status success.');
} finally {
  await app.close();
  await pool.end();
}
