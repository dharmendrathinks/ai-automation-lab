import { connect } from '../apps/api/src/db/index.js';
import { deliverPendingEvents } from '../apps/api/src/outbox.js';

const { DATABASE_URL, N8N_WEBHOOK_TOKEN, N8N_TRIAGE_WEBHOOK_URL = 'http://127.0.0.1:5678/webhook/relaydesk-triage', N8N_ACTION_WEBHOOK_URL = 'http://127.0.0.1:5678/webhook/relaydesk-action' } = process.env;
if (!DATABASE_URL || !N8N_WEBHOOK_TOKEN) throw new Error('DATABASE_URL and N8N_WEBHOOK_TOKEN are required');
const { db, pool } = connect(DATABASE_URL);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopping = true; });
try {
  while (!stopping) {
    await deliverPendingEvents(db, { 'ticket.created': N8N_TRIAGE_WEBHOOK_URL, 'action.ready': N8N_ACTION_WEBHOOK_URL }, N8N_WEBHOOK_TOKEN);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
} finally {
  await pool.end();
}
