import { buildApp } from '../apps/api/src/app.js';
import { connect } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';
import { deliverPendingEvents } from '../apps/api/src/outbox.js';

const { DATABASE_URL, LAB_OPERATOR_TOKEN, N8N_WEBHOOK_TOKEN } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN || !N8N_WEBHOOK_TOKEN) throw new Error('Run after pnpm run setup');
const { db, pool } = connect(DATABASE_URL);
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN, n8nToken: N8N_WEBHOOK_TOKEN });
const operator = { authorization: `Bearer ${LAB_OPERATOR_TOKEN}` };
const webhooks = { 'ticket.created': 'http://127.0.0.1:5678/webhook/relaydesk-triage', 'action.ready': 'http://127.0.0.1:5678/webhook/relaydesk-action' };
try {
  await migrate(pool); await seed(db);
  await pool.query('TRUNCATE tickets, automation_runs, audit_events, outbox_events, ai_jobs, workflow_executions, proposed_actions, approvals, refunds, ticket_messages, operation_receipts CASCADE');
  await pool.query('UPDATE payments SET refunded_amount_minor=0');
  await app.listen({ host: '127.0.0.1', port: 3001 });
  const intake = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers: operator, payload: { customerRef: 'CUSTOMER-001', message: 'I was charged twice this month.' } });
  const { runId, ticketId } = intake.json<{ runId: string; ticketId: string }>();
  await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN);
  const pending = (await app.inject({ url: '/api/v1/approvals', headers: operator })).json<{ approvals: Array<{ id: string; status: string }> }>().approvals[0];
  if (!pending || pending.status !== 'pending') throw new Error('refund proposal did not await approval');
  if (Number((await pool.query('SELECT count(*) FROM refunds')).rows[0].count) !== 0) throw new Error('refund occurred before approval');
  const n8nDecision = await app.inject({ method: 'POST', url: `/api/v1/approvals/${pending.id}/decision`, headers: { authorization: `Bearer ${N8N_WEBHOOK_TOKEN}` }, payload: { decision: 'approved', reason: 'attempted workflow approval' } });
  if (n8nDecision.statusCode !== 401) throw new Error('n8n credential could approve a refund');
  const approved = await app.inject({ method: 'POST', url: `/api/v1/approvals/${pending.id}/decision`, headers: operator, payload: { decision: 'approved', reason: 'Synthetic duplicate payment evidence confirmed.' } });
  if (approved.statusCode !== 200) throw new Error(`approval failed: ${approved.body}`);
  await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN);
  const state = (await pool.query(`SELECT r.payment_id, r.amount_minor, r.status, p.refunded_amount_minor, a.status action_status, a.business_outcome, t.status ticket_status
    FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN proposed_actions a ON a.id=r.action_id JOIN automation_runs ar ON ar.id=a.run_id JOIN tickets t ON t.id=ar.ticket_id
    WHERE ar.id=$1`, [runId])).rows[0];
  if (!state || state.payment_id !== 'PAY-002' || state.amount_minor !== 2900 || state.status !== 'completed' || state.refunded_amount_minor !== 2900 || state.action_status !== 'verified' || state.business_outcome !== 'verified' || state.ticket_status !== 'resolved') throw new Error(`refund not verified: ${JSON.stringify(state)}`);
  const destination = (await app.inject({ url: `/integrations/v1/tickets/${ticketId}`, headers: operator })).json<{ messages: unknown[] }>();
  if (destination.messages.length !== 1) throw new Error('verified refund confirmation missing');
  console.log('No approval produced no refund; exact approval produced one independently verified PAY-002 refund.');
} finally { await app.close(); await pool.end(); }
