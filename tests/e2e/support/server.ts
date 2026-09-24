// Test-only entry point. Never imported by apps/api/src/server.ts or built into a release.
import { buildApp } from '../../../apps/api/src/app.js';
import { connect } from '../../../apps/api/src/db/index.js';
import { migrate } from '../../../apps/api/src/db/migrate.js';
import { seed } from '../../../apps/api/src/db/seed.js';
import { FixtureProvider } from '../../../apps/api/src/providers.js';
import { deliverPendingEvents } from '../../../apps/api/src/outbox.js';
import { z } from 'zod';
import {
  AUTOMATION_TOKEN,
  FIXTURE_CLOCK,
  OPERATOR_TOKEN,
  TEST_DATABASE_URL,
} from './constants.js';

if (
  process.env.RELAYDESK_E2E !== '1' ||
  process.env.DATABASE_URL !== TEST_DATABASE_URL ||
  process.env.LAB_AI_MODE !== 'fixture' ||
  !/^relaydesk-e2e-\d+-[a-f0-9]{8}$/.test(
    process.env.RELAYDESK_E2E_INSTANCE ?? '',
  )
) {
  throw new Error(
    'Test control routes require the isolated fixture-only E2E container.',
  );
}
const { db, pool } = connect(TEST_DATABASE_URL);
await migrate(pool);
await seed(db);
let epoch = Date.now(),
  offset = 0,
  paused = false,
  stopping = false;
const now = () =>
  new Date(Date.parse(FIXTURE_CLOCK) + Date.now() - epoch + offset);
const app = buildApp({
  db,
  token: OPERATOR_TOKEN,
  n8nToken: AUTOMATION_TOKEN,
  n8nOrigin: 'http://n8n:5678',
  provider: new FixtureProvider(),
  now,
});
let delivery: Promise<unknown> | undefined;
const tick = () => {
  if (!paused && !stopping && !delivery) {
    delivery = deliverPendingEvents(
      db,
      {
        'ticket.created': 'http://n8n:5678/webhook/relaydesk-triage',
        'action.ready': 'http://n8n:5678/webhook/relaydesk-action',
      },
      AUTOMATION_TOKEN,
      now(),
    )
      .catch(() => {
        console.error(
          'E2E outbox delivery failed; inspect durable outbox state.',
        );
      })
      .finally(() => {
        delivery = undefined;
      });
  }
};
app.get('/__e2e/identity', async () => ({
  instance: process.env.RELAYDESK_E2E_INSTANCE,
  mode: 'FIXTURE MODE',
}));
app.post('/__e2e/reset', async () => {
  paused = true;
  await delivery;
  // Hard-coded connection is reachable only inside this disposable Compose network.
  await pool.query(
    'TRUNCATE tickets, operation_receipts, wait_exercises CASCADE',
  );
  await pool.query('UPDATE payments SET refunded_amount_minor = 0');
  epoch = Date.now();
  offset = 0;
  paused = false;
  return { reset: true };
});
app.post('/__e2e/worker', async (request, reply) => {
  const input = z.strictObject({ paused: z.boolean() }).safeParse(request.body);
  if (!input.success)
    return reply.code(400).send({ error: 'invalid_test_control' });
  paused = input.data.paused;
  if (paused) await delivery;
  return { paused };
});
app.post('/__e2e/clock', async (request, reply) => {
  const input = z
    .strictObject({ advanceSeconds: z.number().int().min(0).max(172800) })
    .safeParse(request.body);
  if (!input.success)
    return reply.code(400).send({ error: 'invalid_test_control' });
  offset += input.data.advanceSeconds * 1000;
  return { now: now().toISOString() };
});
app.get<{ Params: { id: string } }>(
  '/__e2e/oracle/:id',
  async (request, reply) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success)
      return reply.code(400).send({ error: 'invalid_test_control' });
    const ticket = (
      await pool.query('SELECT * FROM tickets WHERE id=$1', [id.data])
    ).rows[0];
    const run = (
      await pool.query('SELECT * FROM automation_runs WHERE ticket_id=$1', [
        id.data,
      ])
    ).rows[0];
    if (!ticket || !run) return reply.code(404).send({ error: 'not_found' });
    const rows = async (query: string) =>
      (await pool.query(query, [run.id])).rows;
    return {
      ticket,
      run,
      actions: await rows('SELECT * FROM proposed_actions WHERE run_id=$1'),
      approvals: await rows(
        'SELECT p.* FROM approvals p JOIN proposed_actions a ON a.id=p.action_id WHERE a.run_id=$1',
      ),
      messages: await rows(
        'SELECT m.* FROM ticket_messages m JOIN proposed_actions a ON a.id=m.action_id WHERE a.run_id=$1',
      ),
      refunds: await rows(
        'SELECT f.* FROM refunds f JOIN proposed_actions a ON a.id=f.action_id WHERE a.run_id=$1',
      ),
      payments: (
        await pool.query(
          'SELECT id, refunded_amount_minor FROM payments WHERE customer_id=$1',
          [ticket.customer_id],
        )
      ).rows,
      receipts: await rows(
        'SELECT r.* FROM operation_receipts r JOIN proposed_actions a ON a.idempotency_key=r.idempotency_key WHERE a.run_id=$1',
      ),
      attempts: await rows(
        'SELECT x.* FROM action_attempts x JOIN proposed_actions a ON a.id=x.action_id WHERE a.run_id=$1 ORDER BY x.created_at',
      ),
      audit: await rows(
        'SELECT event_type, evidence FROM audit_events WHERE run_id=$1',
      ),
      jobs: await rows('SELECT provider, status FROM ai_jobs WHERE run_id=$1'),
      workflows: await rows(
        'SELECT technical_status FROM workflow_executions WHERE run_id=$1',
      ),
      outbox: await rows(
        'SELECT event_type, status, attempts FROM outbox_events WHERE run_id=$1',
      ),
    };
  },
);
app.get('/__e2e/n8n-health', async () => ({
  ready: await fetch('http://n8n:5678/healthz/readiness', {
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => r.ok)
    .catch(() => false),
}));
app.post<{ Params: { id: string } }>(
  '/__e2e/wait/:id/start',
  async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success)
      return reply.code(400).send({ error: 'invalid_test_control' });
    const response = await fetch(
      'http://n8n:5678/webhook/relaydesk-wait-start',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTOMATION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ exerciseId: request.params.id }),
        signal: AbortSignal.timeout(10000),
      },
    );
    return { accepted: response.ok };
  },
);
app.get<{ Params: { id: string } }>(
  '/__e2e/wait/:id',
  async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success)
      return reply.code(400).send({ error: 'invalid_test_control' });
    const result = await pool.query(
      'SELECT status, resume_url IS NOT NULL AS registered, callback_attempts FROM wait_exercises WHERE id=$1',
      [request.params.id],
    );
    return result.rows[0] ?? reply.code(404).send({ error: 'not_found' });
  },
);
const timer = setInterval(tick, 150);
app.addHook('onClose', async () => {
  stopping = true;
  clearInterval(timer);
  await delivery;
  await pool.end();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    stopping = true;
    clearInterval(timer);
    void app.close();
  });
await app.listen({ host: '0.0.0.0', port: 3001 });
console.log('Isolated fixture-only E2E API ready.');
