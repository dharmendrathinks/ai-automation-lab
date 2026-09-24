import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { connect } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { buildApp } from './app.js';
import { FixtureProvider } from './providers.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run pnpm test:integration to create an isolated database.');
const { db, pool } = connect(process.env.TEST_DATABASE_URL);
const token = 'test-only-operator-token-000000000000';
const app = buildApp({ db, token, now: () => new Date('2026-09-13T00:00:00Z') });
const headers = { authorization: `Bearer ${token}` };
const payload = { customerRef: 'CUSTOMER-001', message: 'I was charged twice this month.' };
const post = (body: unknown = payload) => app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: body as object });
const counts = async () => (await pool.query(`SELECT
  (SELECT count(*)::int FROM tickets) AS tickets,
  (SELECT count(*)::int FROM automation_runs) AS runs,
  (SELECT count(*)::int FROM audit_events) AS audit,
  (SELECT count(*)::int FROM outbox_events) AS outbox`)).rows[0];
beforeAll(async () => { await migrate(pool); await seed(db); await app.ready(); });
beforeEach(async () => { await pool.query('TRUNCATE tickets, automation_runs, audit_events, outbox_events CASCADE'); });
afterAll(async () => { await app.close(); await pool.end(); });

test('ticket intake atomically persists a pending run, audit and versioned event', async () => {
  const response = await post();
  expect(response.statusCode).toBe(201);
  const result = response.json();
  expect(await counts()).toEqual({ tickets: 1, runs: 1, audit: 1, outbox: 1 });
  const run = (await app.inject({ url: `/api/v1/runs/${result.runId}`, headers })).json();
  expect(run).toMatchObject({ phase: 'pending', mode: 'FIXTURE MODE' });
  expect(run.events[0]).toMatchObject({ status: 'pending', payload: {
    eventId: result.eventId, ticketId: result.ticketId, runId: result.runId,
    eventType: 'ticket.created', schemaVersion: 1, occurredAt: '2026-09-13T00:00:00.000Z',
  } });
  expect(run.audit[0].evidence.customerResolved).toBe(true);
  expect(JSON.stringify(run.audit)).not.toContain(payload.message);
});
test('unknown customer remains unresolved for future triage', async () => {
  const result = (await post({ ...payload, customerRef: 'MISSING' })).json();
  const ticket = (await app.inject({ url: `/api/v1/tickets/${result.ticketId}`, headers })).json();
  expect(ticket.customerId).toBeNull();
  expect(ticket.customerRef).toBe('MISSING');
});
test('outbox insertion failure rolls back every intake record', async () => {
  await pool.query(`CREATE FUNCTION reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected outbox failure'; END $$;
    CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_outbox();`);
  try {
    const response = await post();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
    expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
  } finally { await pool.query('DROP TRIGGER reject_outbox ON outbox_events; DROP FUNCTION reject_outbox()'); }
});
test('unauthorized intake cannot mutate state', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/v1/tickets', payload })).statusCode).toBe(401);
  expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
});
test.each([
  { ...payload, action: 'refund_all' }, { ...payload, message: '   ' },
  { ...payload, message: 'x'.repeat(8001) }, { message: 'missing customer' },
])('invalid ticket input is rejected: %j', async (body) => {
  expect((await post(body)).statusCode).toBe(400);
  expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
});
test('business reads return only the requested customer payments', async () => {
  const response = await app.inject({ url: '/integrations/v1/customers/CUSTOMER-001/payments', headers });
  expect(response.json().payments.map((payment: { id: string }) => payment.id)).toEqual(['PAY-001', 'PAY-002']);
  expect((await app.inject({ url: '/integrations/v1/customers/MISSING/payments', headers })).statusCode).toBe(404);
});
test('migrations and baseline seed can be run twice without duplication', async () => {
  await migrate(pool); await seed(db);
  expect((await pool.query('SELECT count(*)::int AS count FROM payments')).rows[0].count).toBe(3);
});
test('database rejects cross-customer payment ownership and excessive refunded amounts', async () => {
  await expect(pool.query("UPDATE payments SET customer_id = 'CUSTOMER-002' WHERE id = 'PAY-001'")).rejects.toMatchObject({ code: '23503' });
  await expect(pool.query("UPDATE payments SET refunded_amount_minor = 3000 WHERE id = 'PAY-001'")).rejects.toMatchObject({ code: '23514' });
});
test('malformed resource IDs return a safe client error', async () => {
  expect((await app.inject({ url: '/api/v1/runs/not-a-uuid', headers })).statusCode).toBe(400);
});

const classifyAndPropose = async (message = 'How can I download my invoice?') => {
  const created = (await post({ customerRef: 'CUSTOMER-001', message })).json();
  expect((await app.inject({ method: 'POST', url: `/automation/v1/runs/${created.runId}/decision`, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/automation/v1/runs/${created.runId}/policy`, headers })).statusCode).toBe(200);
  const run = (await app.inject({ url: `/api/v1/runs/${created.runId}`, headers })).json();
  return { ...created, run, actionId: run.actions[0]?.id };
};

test('dashboard assets are public, same-origin, and do not expose API credentials', async () => {
  for (const path of ['/dashboard', '/dashboard/styles.css', '/dashboard/app.js', '/dashboard/format.js']) {
    const response = await app.inject({ url: path });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.body).not.toContain(token);
  }
  const html = (await app.inject({ url: '/dashboard' })).body;
  for (const label of ['Overview', 'Tickets', 'Approvals', 'Reliability lab', 'Outcomes']) expect(html).toContain(label);
  expect((await app.inject({ url: '/dashboard/../../.env' })).statusCode).not.toBe(200);
  expect((await app.inject({ url: '/api/v1/tickets' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/v1/metrics/outcomes' })).statusCode).toBe(401);
});

test('ticket queue, conversation and run views expose real related evidence', async () => {
  const c = await classifyAndPropose();
  await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/execute`, headers });
  await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/verify`, headers });
  const list = (await app.inject({ url: '/api/v1/tickets', headers })).json();
  expect(list.tickets[0]).toMatchObject({ id: c.ticketId, customerName: 'Morgan Example', runId: c.runId, status: 'resolved', verifiedActions: 1, mode: 'FIXTURE MODE' });
  const ticket = (await app.inject({ url: `/api/v1/tickets/${c.ticketId}`, headers })).json();
  expect(ticket.messages).toHaveLength(1); expect(ticket.runs[0].id).toBe(c.runId);
  const run = (await app.inject({ url: `/api/v1/runs/${c.runId}`, headers })).json();
  expect(run.actions[0].businessOutcome).toBe('verified'); expect(run.attempts).toHaveLength(1);
  expect(run.jobs[0].provider).toBe('fixture'); expect(run.audit.some((a: { eventType: string }) => a.eventType === 'support_response.verified')).toBe(true);
});

test('review queue contains the frozen proposal and conflicting reviewers cannot both decide', async () => {
  const c = await classifyAndPropose('I was charged twice this month.');
  const list = (await app.inject({ url: '/api/v1/approvals', headers })).json();
  const approval = list.approvals[0];
  expect(approval).toMatchObject({ status: 'pending', action: { runId: c.runId, parameters: { paymentId: 'PAY-002', amountMinor: 2900 } }, ticket: { id: c.ticketId } });
  const decisions = await Promise.all(['approved', 'rejected'].map((decision) => app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.id}/decision`, headers, payload: { decision, reason: 'Synthetic review evidence checked.' } })));
  expect(decisions.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE event_type IN ('approval.approved','approval.rejected')")).rows[0].count).toBe(1);
});

test('empty metrics stay N/A and include an explicit cohort and cutoff', async () => {
  const m = (await app.inject({ url: '/api/v1/metrics/outcomes?mode=fixture', headers })).json();
  expect(m).toMatchObject({ mode: 'FIXTURE MODE', cohort: { tickets: 0, cutoff: '2026-09-13T00:00:00.000Z' }, automationRate: null, verifiedCompletionRate: null, humanMinutesPerTicket: null, modelCost: null });
  expect((await app.inject({ url: '/api/v1/metrics/outcomes?mode=combined', headers })).statusCode).toBe(400);
});

test('metrics retain pending work and exclude approved resolutions from full automation', async () => {
  const support = await classifyAndPropose();
  await app.inject({ method: 'POST', url: `/automation/v1/actions/${support.actionId}/execute`, headers });
  await app.inject({ method: 'POST', url: `/automation/v1/actions/${support.actionId}/verify`, headers });
  const refund = await classifyAndPropose('I was charged twice this month.');
  const approvalId = refund.run.approvals[0].id;
  await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/decision`, headers, payload: { decision: 'approved', reason: 'Checked exact synthetic duplicate payment.' } });
  try {
    expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${refund.actionId}/execute`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${refund.actionId}/verify`, headers })).statusCode).toBe(200);
    await post({ customerRef: 'CUSTOMER-002', message: 'An unprocessed ticket.' });
    const m = (await app.inject({ url: '/api/v1/metrics/outcomes', headers })).json();
    expect(m.cohort.tickets).toBe(3); expect(m.automationRate).toBeCloseTo(1 / 3); expect(m.verifiedCompletionRate).toBeCloseTo(2 / 3);
    expect(m.reliability.attemptedActions).toBe(2); expect(m.humanMinutesPerTicket).toBeNull();
  } finally { await pool.query("UPDATE payments SET refunded_amount_minor=0 WHERE id='PAY-002'"); }
});

test('legacy mode mistakes are corrected by provider metadata without mixing cohorts', async () => {
  const c = await classifyAndPropose();
  // A synthetic stored record represents historical live metadata; no model is called.
  await pool.query("UPDATE ai_jobs SET provider='codex', model='synthetic-live-test' WHERE run_id=$1", [c.runId]);
  await post();
  const fixture = (await app.inject({ url: '/api/v1/metrics/outcomes?mode=fixture', headers })).json();
  const live = (await app.inject({ url: '/api/v1/metrics/outcomes?mode=live', headers })).json();
  expect(fixture.cohort.tickets).toBe(1); expect(live.cohort.tickets).toBe(1);
  expect((await app.inject({ url: `/api/v1/runs/${c.runId}`, headers })).json().mode).toBe('LIVE AI MODE');
});

test('live intake records mode before inference and the failure lab is fixture-only', async () => {
  const fixture = new FixtureProvider();
  const live = buildApp({ db, token, provider: { mode: 'LIVE AI MODE', provider: 'codex', model: 'synthetic-test', classify: fixture.classify.bind(fixture) } });
  try {
    const created = await live.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload });
    expect(created.json().mode).toBe('LIVE AI MODE');
    const scenario = await live.inject({ method: 'POST', url: '/api/v1/scenarios/false-success/start', headers, payload: {} });
    expect(scenario.statusCode).toBe(409); expect(scenario.json().error).toBe('fixture_mode_required');
    expect((await counts()).tickets).toBe(1);
  } finally { await live.close(); }
});

test('browser reliability experiments create support tickets with persisted faults', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/v1/scenarios/false-success/start', headers, payload: { customerRef: 'CUSTOMER-001', message: 'How can I download my invoice?' } });
  expect(response.statusCode).toBe(201);
  const runId = response.json().runId;
  await app.inject({ method: 'POST', url: `/automation/v1/runs/${runId}/decision`, headers });
  await app.inject({ method: 'POST', url: `/automation/v1/runs/${runId}/policy`, headers });
  const run = (await app.inject({ url: `/api/v1/runs/${runId}`, headers })).json();
  expect(run.scenarios[0].fixtureId).toBe('false-success');
  const actionId = run.actions[0].id;
  expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${actionId}/execute`, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${actionId}/verify`, headers })).json().outcome).toBe('failed');
  expect((await app.inject({ url: `/api/v1/tickets/${response.json().ticketId}`, headers })).json().messages).toHaveLength(0);
});

test('a failure to persist the scenario rolls back intake before an outbox worker can observe it', async () => {
  await pool.query(`CREATE FUNCTION reject_scenario() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected scenario failure'; END $$;
    CREATE TRIGGER reject_scenario BEFORE INSERT ON scenario_instances FOR EACH ROW EXECUTE FUNCTION reject_scenario();`);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/scenarios/false-success/start', headers, payload: {} });
    expect(response.statusCode).toBe(500); expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
  } finally { await pool.query('DROP TRIGGER reject_scenario ON scenario_instances; DROP FUNCTION reject_scenario()'); }
});
