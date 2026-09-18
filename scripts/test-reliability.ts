import { spawnSync } from 'node:child_process';
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

async function scenario(name: string) {
  await pool.query('UPDATE payments SET refunded_amount_minor=0');
  const start = await app.inject({ method: 'POST', url: `/api/v1/scenarios/${name}/start`, headers: operator, payload: name === 'verification-unavailable' ? { unavailableReads: 1 } : {} });
  if (start.statusCode !== 201) throw new Error(`scenario start failed: ${start.body}`);
  const { runId } = start.json<{ runId: string }>();
  await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN!);
  const approval = (await pool.query('SELECT ap.id FROM approvals ap JOIN proposed_actions a ON a.id=ap.action_id WHERE a.run_id=$1', [runId])).rows[0];
  if (!approval) throw new Error(`scenario ${name} produced no proposal`);
  const decision = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.id}/decision`, headers: operator, payload: { decision: 'approved', reason: `Approve synthetic ${name} scenario.` } });
  if (decision.statusCode !== 200) throw new Error(`scenario approval failed: ${decision.body}`);
  await deliverPendingEvents(db, webhooks, N8N_WEBHOOK_TOKEN!);
  const state = (await pool.query(`SELECT a.id, a.status, a.business_outcome,
    (SELECT count(*)::int FROM refunds r WHERE r.action_id=a.id) refunds,
    (SELECT count(*)::int FROM action_attempts x WHERE x.action_id=a.id) attempts,
    (SELECT count(*)::int FROM operation_receipts o WHERE o.operation='refund.create' AND o.idempotency_key=a.idempotency_key) receipts
    FROM proposed_actions a WHERE a.run_id=$1`, [runId])).rows[0];
  return { runId, ...state } as { runId: string; id: string; status: string; business_outcome: string; refunds: number; attempts: number; receipts: number };
}

try {
  await migrate(pool); await seed(db);
  await pool.query('TRUNCATE tickets, automation_runs, audit_events, outbox_events, ai_jobs, workflow_executions, proposed_actions, approvals, refunds, ticket_messages, operation_receipts, scenario_instances, action_attempts CASCADE');
  await app.listen({ host: '127.0.0.1', port: 3001 });

  const beforeCommit = await scenario('fail-before-commit');
  if (beforeCommit.refunds !== 1 || beforeCommit.attempts !== 2 || beforeCommit.status !== 'verified') throw new Error(`failed retry scenario: ${JSON.stringify(beforeCommit)}`);

  await pool.query('DELETE FROM refunds; DELETE FROM operation_receipts; DELETE FROM ticket_messages; UPDATE payments SET refunded_amount_minor=0');
  const lost = await scenario('commit-lost-response');
  if (lost.refunds !== 1 || lost.receipts !== 1 || lost.attempts !== 2 || lost.status !== 'verified') throw new Error(`lost response duplicated work: ${JSON.stringify(lost)}`);

  await pool.query('DELETE FROM refunds; DELETE FROM operation_receipts; DELETE FROM ticket_messages; UPDATE payments SET refunded_amount_minor=0');
  const falseSuccess = await scenario('false-success');
  if (falseSuccess.refunds !== 0 || falseSuccess.status !== 'failed' || falseSuccess.business_outcome !== 'failed') throw new Error(`false success escaped verification: ${JSON.stringify(falseSuccess)}`);

  const unknown = await scenario('verification-unavailable');
  if (unknown.refunds !== 1 || unknown.status !== 'unknown' || unknown.business_outcome !== 'unknown') throw new Error(`unknown outcome was misreported: ${JSON.stringify(unknown)}`);
  const restart = spawnSync('docker', ['compose', '--env-file', '.env', 'restart', 'n8n'], { encoding: 'utf8' });
  if (restart.status !== 0) throw new Error(`n8n restart failed: ${restart.stderr}`);
  const wait = spawnSync('docker', ['compose', '--env-file', '.env', 'up', '-d', '--wait', 'n8n'], { encoding: 'utf8' });
  if (wait.status !== 0) throw new Error(`n8n health wait failed: ${wait.stderr}`);
  const reconciled = await app.inject({ method: 'POST', url: `/api/v1/runs/${unknown.runId}/reconcile`, headers: operator });
  if (reconciled.statusCode !== 200 || reconciled.json<{ outcome: string }>().outcome !== 'verified') throw new Error(`reconciliation failed after restart: ${reconciled.body}`);
  const after = (await pool.query('SELECT count(*)::int refunds FROM refunds WHERE action_id=$1', [unknown.id])).rows[0];
  if (after.refunds !== 1) throw new Error('reconciliation issued a duplicate refund');
  console.log('Failure retry, lost response, false success, unknown outcome, restart and reconciliation scenarios all passed without duplicate refunds.');
} finally { await app.close(); await pool.end(); }
