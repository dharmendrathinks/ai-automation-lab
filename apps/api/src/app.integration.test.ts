import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { connect } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { buildApp } from './app.js';

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
