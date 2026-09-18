import { buildApp } from '../apps/api/src/app.js';
import { connect } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';
import { deliverPendingEvents } from '../apps/api/src/outbox.js';
import { CodexProvider, FixtureProvider } from '../apps/api/src/providers.js';
import { resolve } from 'node:path';

const { DATABASE_URL, LAB_OPERATOR_TOKEN, N8N_WEBHOOK_TOKEN, LAB_AI_MODE, LAB_CODEX_BIN, LAB_CODEX_HOME } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN || !N8N_WEBHOOK_TOKEN) throw new Error('Run after pnpm run setup');
if (LAB_AI_MODE === 'live' && !LAB_CODEX_BIN) throw new Error('LAB_CODEX_BIN is required in live mode');
const provider = LAB_AI_MODE === 'live' ? new CodexProvider(LAB_CODEX_BIN!, resolve(LAB_CODEX_HOME ?? '.local/codex-runtime')) : new FixtureProvider();
const { db, pool } = connect(DATABASE_URL);
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN, n8nToken: N8N_WEBHOOK_TOKEN, provider });
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
  const metrics = (await app.inject({ url: '/api/v1/metrics/outcomes', headers })).json<{ mode: string; automationRate: number; verifiedCompletionRate: number }>();
  if (metrics.mode !== provider.mode || metrics.automationRate !== 1 || metrics.verifiedCompletionRate !== 1) throw new Error(`outcome metrics failed: ${JSON.stringify(metrics)}`);
  console.log(`Workflow B stored one canonical response, read it back independently, and resolved the ticket as verified — ${provider.mode}.`);
} finally { await app.close(); await pool.end(); }
