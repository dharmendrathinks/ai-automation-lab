import { buildApp } from './app.js';
import { connect } from './db/index.js';

const { DATABASE_URL, LAB_OPERATOR_TOKEN } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN) throw new Error('DATABASE_URL and LAB_OPERATOR_TOKEN are required. See .env.example.');
const { db, pool } = connect(DATABASE_URL);
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN });
app.addHook('onClose', async () => { await pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ port: 3001, host: '127.0.0.1' });
console.log('RelayDesk API: http://127.0.0.1:3001 — FIXTURE MODE. Outbox delivery is not implemented yet.');
