import { buildApp } from '../apps/api/src/app.js';
import { connect } from '../apps/api/src/db/index.js';
import { deliverPendingEvents } from '../apps/api/src/outbox.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';

const { DATABASE_URL, LAB_OPERATOR_TOKEN, N8N_WEBHOOK_TOKEN } = process.env;
if (!DATABASE_URL || !LAB_OPERATOR_TOKEN || !N8N_WEBHOOK_TOKEN) throw new Error('Run after pnpm run setup');
const { db, pool } = connect(DATABASE_URL);
const app = buildApp({ db, token: LAB_OPERATOR_TOKEN, n8nToken: N8N_WEBHOOK_TOKEN });
const headers = { authorization: `Bearer ${LAB_OPERATOR_TOKEN}` };
const webhook = 'http://127.0.0.1:5678/webhook/relaydesk-triage';

try {
  await migrate(pool);
  await seed(db);
  await pool.query('TRUNCATE tickets, automation_runs, audit_events, outbox_events, ai_jobs, workflow_executions CASCADE');
  await app.listen({ host: '127.0.0.1', port: 3001 });
  const intake = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: { customerRef: 'CUSTOMER-001', message: 'Where can I download my invoices?' } });
  if (intake.statusCode !== 201) throw new Error(`ticket intake failed: ${intake.body}`);
  const created = intake.json<{ runId: string; eventId: string }>();
  const delivered = await deliverPendingEvents(db, webhook, N8N_WEBHOOK_TOKEN);
  if (delivered.delivered !== 1) throw new Error(`outbox delivery failed: ${JSON.stringify(delivered)}`);
  const run = (await app.inject({ url: `/api/v1/runs/${created.runId}`, headers })).json<{ phase: string; outcome: string; events: Array<{ eventType: string; payload: unknown }> }>();
  if (run.phase !== 'completed' || run.outcome !== 'automatic_support') throw new Error(`unexpected triage outcome: ${JSON.stringify(run)}`);
  const ticketEvent = run.events.find((event) => event.eventType === 'ticket.created');
  const duplicate = await fetch(webhook, { method: 'POST', headers: { authorization: `Bearer ${N8N_WEBHOOK_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(ticketEvent?.payload) });
  if (!duplicate.ok) throw new Error(`duplicate webhook failed: ${duplicate.status} ${await duplicate.text()}`);
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM ai_jobs WHERE run_id=$1) ai_jobs,
    (SELECT count(*)::int FROM workflow_executions WHERE run_id=$1) executions,
    (SELECT count(*)::int FROM audit_events WHERE run_id=$1 AND event_type='workflow.claimed') claims`, [created.runId])).rows[0];
  if (counts.ai_jobs !== 1 || counts.executions !== 1 || counts.claims !== 1) throw new Error(`duplicate logical work detected: ${JSON.stringify(counts)}`);
  const missing = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: { customerRef: 'MISSING', message: 'Please help with my account.' } });
  const missingRunId = missing.json<{ runId: string }>().runId;
  await deliverPendingEvents(db, webhook, N8N_WEBHOOK_TOKEN);
  const escalated = (await app.inject({ url: `/api/v1/runs/${missingRunId}`, headers })).json<{ outcome: string; escalationReason: string }>();
  if (escalated.outcome !== 'human_follow_up' || escalated.escalationReason !== 'customer_identity') throw new Error(`required escalation missing: ${JSON.stringify(escalated)}`);
  console.log('Workflow A delivered, classified, applied policy, escalated safely, and suppressed duplicate logical work.');
} finally {
  await app.close();
  await pool.end();
}
