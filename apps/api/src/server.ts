import { buildApp } from './app.js';
import { connect } from './db/index.js';
import { CodexProvider, FixtureProvider } from './providers.js';
import { resolve } from 'node:path';

const { DATABASE_URL, LAB_OPERATOR_TOKEN, N8N_WEBHOOK_TOKEN, LAB_AI_MODE, LAB_CODEX_BIN, LAB_CODEX_HOME } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN || !N8N_WEBHOOK_TOKEN) throw new Error('DATABASE_URL, LAB_OPERATOR_TOKEN and N8N_WEBHOOK_TOKEN are required. See .env.example.');
if (LAB_AI_MODE && !['fixture', 'live'].includes(LAB_AI_MODE)) throw new Error('LAB_AI_MODE must be fixture or live.');
if (LAB_AI_MODE === 'live' && !LAB_CODEX_BIN) throw new Error('LAB_CODEX_BIN is required for live mode.');
const provider = LAB_AI_MODE === 'live' ? new CodexProvider(LAB_CODEX_BIN!, resolve(LAB_CODEX_HOME ?? '.local/codex-runtime')) : new FixtureProvider();
const { db, pool } = connect(DATABASE_URL);
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN, n8nToken: N8N_WEBHOOK_TOKEN, provider });
app.addHook('onClose', async () => { await pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ port: 3001, host: '127.0.0.1' });
console.log(`RelayDesk API: http://127.0.0.1:3001 — ${provider.mode}.`);
