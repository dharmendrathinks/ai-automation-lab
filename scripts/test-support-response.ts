import { buildApp } from '../apps/api/src/app.js';
import { connect } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';
import { deliverPendingEvents } from '../apps/api/src/outbox.js';

const { DATABASE_URL, LAB_OPERATOR_TOKEN, N8N_WEBHOOK_TOKEN } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN || !N8N_WEBHOOK_TOKEN) throw new Error('Run after pnpm run setup');
const { db, pool } = connect(DATABASE_URL);
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN, n8nToken: N8N_WEBHOOK_TOKEN });
const headers = { authorization: `Bearer ${LAB_OPERATOR_TOKEN}` };
const webhooks = { 'ticket.created': 'http://127.0.0.1:5678/webhook/relaydesk-triage', 'action.ready': 'http://127.0.0.1:5678/webhook/relaydesk-action' };
try {
  await migrate(pool); await seed(db);
  await pool.query('TRUNCATE tickets, automation_runs, audit_events, outbox_events, ai_jobs, workflow_executions, proposed_actions, ticket_messages, operation_receipts CASCADE');
  await app.listen({ host: '127.0.0.1', port: 3001 });
  const intake = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: { customerRef: 'CUSTOMER-001', message: 'Where can I download my invoices?' } });
  const { runId, ticketId } = intake.json<{ runId: string; ticketId: string }>();
  if ((await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN)).delivered !== 1) throw new Error('triage delivery failed');
  if ((await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN)).delivered !== 1) throw new Error('action delivery failed');
  const destination = (await app.inject({ url: `/integrations/v1/tickets/${ticketId}`, headers })).json<{ status: string; messages: Array<{ text: string }> }>();
  const actions = (await app.inject({ url: `/api/v1/runs/${runId}/actions`, headers })).json<{ actions: Array<{ status: string; businessOutcome: string }> }>();
  if (destination.status !== 'resolved' || destination.messages.length !== 1 || destination.messages[0]?.text !== 'You can download invoices from Settings → Billing → Invoices.') throw new Error(`destination verification failed: ${JSON.stringify(destination)}`);
  if (actions.actions[0]?.status !== 'verified' || actions.actions[0]?.businessOutcome !== 'verified') throw new Error(`action not verified: ${JSON.stringify(actions)}`);
  await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN);
  const counts = (await pool.query('SELECT (SELECT count(*)::int FROM ticket_messages) messages, (SELECT count(*)::int FROM operation_receipts) receipts')).rows[0];
  if (counts.messages !== 1 || counts.receipts !== 1) throw new Error(`support action duplicated: ${JSON.stringify(counts)}`);
  console.log('Workflow B stored one canonical response, read it back independently, and resolved the ticket as verified.');
} finally { await app.close(); await pool.end(); }
