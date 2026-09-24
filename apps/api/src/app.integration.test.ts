import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import { connect } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { buildApp } from './app.js';
import { FixtureProvider } from './providers.js';
import { classifyRun, evaluateTriagePolicy } from './triage.js';
import {
  approveWaitExercise,
  completeWait,
  createWaitExercise,
  registerWait,
  resumeWait,
} from './waits.js';
import { randomUUID } from 'node:crypto';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('Run pnpm test:integration to create an isolated database.');
const { db, pool } = connect(process.env.TEST_DATABASE_URL);
const token = 'test-only-operator-token-000000000000';
const app = buildApp({
  db,
  token,
  now: () => new Date('2026-09-13T00:00:00Z'),
});
const headers = { authorization: `Bearer ${token}` };
const payload = {
  customerRef: 'CUSTOMER-001',
  message: 'I was charged twice this month.',
};
const post = (body: unknown = payload) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/tickets',
    headers,
    payload: body as object,
  });
const counts = async () =>
  (
    await pool.query(`SELECT
  (SELECT count(*)::int FROM tickets) AS tickets,
  (SELECT count(*)::int FROM automation_runs) AS runs,
  (SELECT count(*)::int FROM audit_events) AS audit,
  (SELECT count(*)::int FROM outbox_events) AS outbox`)
  ).rows[0];
beforeAll(async () => {
  await migrate(pool);
  await seed(db);
  await app.ready();
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE tickets, automation_runs, audit_events, outbox_events CASCADE',
  );
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
afterEach(() => vi.unstubAllGlobals());

const clock = new Date('2026-09-13T00:00:00Z');
test.each(['short', token])('automation credentials must be strong and distinct: %s', (n8nToken) => {
  expect(() => buildApp({ db, token, n8nToken })).toThrow(/N8N_WEBHOOK_TOKEN/);
});

test('automation credentials cannot cross the operator boundary or forge approval fields', async () => {
  const n8nToken = 'synthetic-automation-token-00000000000';
  const scoped = buildApp({ db, token, n8nToken, now: () => clock });
  try {
    const c = await classifyAndPropose('I was charged twice this month.');
    const automationHeaders = { authorization: `Bearer ${n8nToken}` };
    for (const url of ['/api/v1/tickets', '/api/v1/approvals', '/api/v1/metrics/outcomes', '/readyz']) {
      expect((await scoped.inject({ url, headers: automationHeaders })).statusCode).toBe(401);
    }
    for (const url of [
      `/api/v1/approvals/${c.run.approvals[0].id}/decision`,
      `/api/v1/tickets/${c.ticketId}/effort`,
      '/api/v1/scenarios/false-success/start',
      '/api/v1/wait-exercises',
    ]) {
      expect((await scoped.inject({ method: 'POST', url, headers: automationHeaders, payload: {} })).statusCode).toBe(401);
    }
    expect((await scoped.inject({ url: '/integrations/v1/customers/CUSTOMER-001/payments', headers: automationHeaders })).statusCode).toBe(200);
    for (const extra of [{ reviewer: 'forged' }, { proposalHash: 'forged' }, { actionId: randomUUID() }, { amountMinor: 1 }]) {
      expect((await scoped.inject({ method: 'POST', url: `/api/v1/approvals/${c.run.approvals[0].id}/decision`, headers, payload: { decision: 'approved', reason: 'Synthetic tampering check', ...extra } })).statusCode).toBe(400);
    }
    expect((await pool.query('SELECT status, reviewer FROM approvals WHERE id=$1', [c.run.approvals[0].id])).rows[0]).toEqual({ status: 'pending', reviewer: null });
    expect((await pool.query('SELECT count(*)::int AS n FROM refunds')).rows[0].n).toBe(0);
  } finally { await scoped.close(); }
});

test.each([
  ['invalid reference', { customerRef: 'invalid reference' }],
  ['long reference', { customerRef: 'x'.repeat(65) }],
  ['empty message', { message: '' }],
  ['blank message', { message: '   ' }],
  ['long message', { message: 'x'.repeat(8001) }],
])('scenario intake enforces the ticket contract: %s', async (_label, invalid) => {
  const response = await app.inject({ method: 'POST', url: '/api/v1/scenarios/false-success/start', headers, payload: invalid });
  expect(response.statusCode).toBe(400);
  expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
});

test('early verification cannot strand an authorized support action before its first execution', async () => {
  const c = await classifyAndPropose();
  const early = await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/verify`, headers });
  expect(early.statusCode).toBe(409);
  expect(early.json()).toEqual({ error: 'verification_not_ready' });
  expect((await pool.query('SELECT status FROM proposed_actions WHERE id=$1', [c.actionId])).rows[0].status).toBe('ready');
  expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/execute`, headers })).statusCode).toBe(200);
  const results = await Promise.all(Array.from({ length: 3 }, () => app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/verify`, headers })));
  expect(results.every((r) => r.json().outcome === 'verified')).toBe(true);
  expect((await pool.query('SELECT count(*)::int AS n FROM ticket_messages WHERE action_id=$1', [c.actionId])).rows[0].n).toBe(1);
});

test('support verification rejects a matching message stored on the wrong ticket', async () => {
  const c = await classifyAndPropose();
  const other = (await post({ customerRef: 'CUSTOMER-002', message: 'Another synthetic ticket.' })).json();
  await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/execute`, headers });
  await pool.query('UPDATE ticket_messages SET ticket_id=$1 WHERE action_id=$2', [other.ticketId, c.actionId]);
  const verified = await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/verify`, headers });
  expect(verified.json()).toMatchObject({ outcome: 'failed', ticketResolution: 'open' });
  expect((await pool.query('SELECT status FROM tickets WHERE id=$1', [c.ticketId])).rows[0].status).toBe('open');
});

test('verification between failed-before-commit and retry cannot strand the action', async () => {
  const c = await classifyAndPropose();
  await pool.query(`INSERT INTO scenario_instances (id,run_id,fixture_id,config,counters,created_at)
    VALUES ($1,$2,'fail-before-commit','{"mode":"fail_before_commit","failAttempts":1}','{}',$3)`, [randomUUID(), c.runId, clock]);
  const first = await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/execute`, headers });
  expect(first.statusCode).toBe(500);
  const early = await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/verify`, headers });
  expect(early.json()).toEqual({ error: 'verification_not_ready' });
  expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/execute`, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/automation/v1/actions/${c.actionId}/verify`, headers })).json().outcome).toBe('verified');
  expect((await pool.query('SELECT count(*)::int AS n FROM ticket_messages WHERE action_id=$1', [c.actionId])).rows[0].n).toBe(1);
});

test('refund without eligible duplicate evidence escalates instead of stranding an open ticket', async () => {
  const created = (
    await post({
      customerRef: 'CUSTOMER-002',
      message: 'I was charged twice this month.',
    })
  ).json();
  await classifyRun(db, created.runId, clock, new FixtureProvider());
  expect(
    (await evaluateTriagePolicy(db, created.runId, clock))?.policy,
  ).toMatchObject({
    route: 'human_follow_up',
    escalationReason: 'refund_eligibility',
  });
  expect(
    (
      await pool.query('SELECT status FROM tickets WHERE id=$1', [
        created.ticketId,
      ])
    ).rows[0].status,
  ).toBe('human_follow_up');
  expect(
    (await pool.query('SELECT count(*)::int AS n FROM proposed_actions'))
      .rows[0].n,
  ).toBe(0);
});
test.each([false, true])(
  'invalid provider output retries once, durable replay never repeats inference (recover=%s)',
  async (recover) => {
    const created = (await post()).json();
    const fixture = new FixtureProvider();
    const classify = vi.fn(async () => {
      if (classify.mock.calls.length === 1 || !recover)
        throw new Error('invalid_output');
      return fixture.classify({
        ticket: {
          id: created.ticketId,
          message: 'How can I download my invoice?',
          customerRef: 'CUSTOMER-001',
        },
        customerResolved: true,
        payments: [],
      });
    });
    const provider = {
      mode: fixture.mode,
      provider: fixture.provider,
      model: fixture.model,
      classify,
    };
    const results = await Promise.all([
      classifyRun(db, created.runId, clock, provider),
      classifyRun(db, created.runId, clock, provider),
    ]);
    expect(classify).toHaveBeenCalledTimes(2);
    expect(results.filter((r) => r?.reused)).toHaveLength(1);
    const policy = await evaluateTriagePolicy(db, created.runId, clock);
    expect(policy?.policy).toMatchObject({
      route: recover ? 'automatic_support' : 'human_follow_up',
    });
    const metrics = (
      await app.inject({ url: '/api/v1/metrics/outcomes', headers })
    ).json();
    expect(metrics.providerAttempts).toEqual({
      total: 2,
      failed: recover ? 1 : 2,
      retries: 1,
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM ai_jobs WHERE run_id=$1',
          [created.runId],
        )
      ).rows[0].n,
    ).toBe(2);
    if (!recover)
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_events WHERE event_type='triage.safety_escalation'",
          )
        ).rows[0].n,
      ).toBe(1);
  },
);
test('backend denies automatic response for unresolved identity even if model recommends it', async () => {
  const created = (
    await post({
      customerRef: 'MISSING',
      message: 'How can I download my invoice?',
    })
  ).json();
  const fixture = new FixtureProvider();
  await classifyRun(db, created.runId, clock, {
    mode: fixture.mode,
    provider: fixture.provider,
    model: fixture.model,
    classify: (c) => fixture.classify({ ...c, customerResolved: true }),
  });
  const result = await evaluateTriagePolicy(db, created.runId, clock);
  expect(result?.policy).toMatchObject({ route: 'human_follow_up' });
  expect(
    (await pool.query('SELECT count(*)::int AS n FROM proposed_actions'))
      .rows[0].n,
  ).toBe(0);
});
test('wait approval/completion races preserve terminal state and one completion', async () => {
  const w = await createWaitExercise(db, clock);
  const votes = await Promise.all([
    approveWaitExercise(db, w.id, clock),
    approveWaitExercise(db, w.id, clock),
  ]);
  expect(votes.filter((v) => !v?.replayed)).toHaveLength(1);
  const completed = await Promise.all([
    completeWait(db, w.id, clock),
    completeWait(db, w.id, clock),
    approveWaitExercise(db, w.id, clock),
  ]);
  expect(completed.filter((v) => v && !v.replayed)).toHaveLength(1);
  expect(
    (await pool.query('SELECT status FROM wait_exercises WHERE id=$1', [w.id]))
      .rows[0].status,
  ).toBe('completed');
});
test('completion cannot bypass expiry, and expiry commits despite conflict', async () => {
  const w = await createWaitExercise(db, clock, 1);
  await approveWaitExercise(db, w.id, clock);
  await expect(
    completeWait(db, w.id, new Date(clock.getTime() + 1000)),
  ).rejects.toThrow('wait_expired');
  expect(
    (await pool.query('SELECT status FROM wait_exercises WHERE id=$1', [w.id]))
      .rows[0].status,
  ).toBe('expired');
  await expect(approveWaitExercise(db, w.id, clock)).rejects.toThrow(
    'wait_expired',
  );
});
test.each([false, true])(
  'late/lost callback response cannot overwrite completion (lost=%s)',
  async (lost) => {
    const w = await createWaitExercise(db, clock);
    await approveWaitExercise(db, w.id, clock);
    await registerWait(
      db,
      w.id,
      'http://127.0.0.1:5678/webhook-waiting/synthetic',
      clock,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await completeWait(db, w.id, clock);
        if (lost) throw new Error('synthetic transport loss');
        return new Response('{}');
      }),
    );
    expect(await resumeWait(db, w.id, clock)).toMatchObject({
      completed: true,
    });
    expect(
      (
        await pool.query(
          'SELECT status, callback_attempts FROM wait_exercises WHERE id=$1',
          [w.id],
        )
      ).rows[0],
    ).toEqual({ status: 'completed', callback_attempts: 1 });
    await resumeWait(db, w.id, clock);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
test('resume retries are bounded and callback URLs cannot redirect or carry credentials', async () => {
  const w = await createWaitExercise(db, clock);
  await approveWaitExercise(db, w.id, clock);
  await expect(
    registerWait(
      db,
      w.id,
      'http://secret@localhost:5678/webhook-waiting/x',
      clock,
    ),
  ).rejects.toThrow('invalid_resume_url');
  await expect(
    registerWait(
      db,
      w.id,
      'http://localhost:5678/webhook-waiting/x?redirect=http://elsewhere',
      clock,
    ),
  ).rejects.toThrow('invalid_resume_url');
  const signed = await createWaitExercise(db, clock);
  await registerWait(
    db,
    signed.id,
    `http://localhost:5678/webhook-waiting/1?signature=${'a'.repeat(64)}`,
    clock,
  );
  expect(
    JSON.stringify(await approveWaitExercise(db, signed.id, clock)),
  ).not.toContain('signature');
  await registerWait(
    db,
    w.id,
    'http://localhost:5678/webhook-waiting/synthetic',
    clock,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
  for (let i = 0; i < 5; i++)
    await expect(resumeWait(db, w.id, clock)).rejects.toThrow(
      'resume_callback_failed',
    );
  await expect(resumeWait(db, w.id, clock)).rejects.toThrow(
    'resume_retry_exhausted',
  );
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  );
});

test('ticket intake atomically persists a pending run, audit and versioned event', async () => {
  const response = await post();
  expect(response.statusCode).toBe(201);
  const result = response.json();
  expect(await counts()).toEqual({ tickets: 1, runs: 1, audit: 1, outbox: 1 });
  const run = (
    await app.inject({ url: `/api/v1/runs/${result.runId}`, headers })
  ).json();
  expect(run).toMatchObject({ phase: 'pending', mode: 'FIXTURE MODE' });
  expect(run.events[0]).toMatchObject({
    status: 'pending',
    payload: {
      eventId: result.eventId,
      ticketId: result.ticketId,
      runId: result.runId,
      eventType: 'ticket.created',
      schemaVersion: 1,
      occurredAt: '2026-09-13T00:00:00.000Z',
    },
  });
  expect(run.audit[0].evidence.customerResolved).toBe(true);
  expect(JSON.stringify(run.audit)).not.toContain(payload.message);
});

test('effort snapshots preserve provenance, coverage, negative savings and idempotency', async () => {
  const c = await classifyAndPropose();
  await app.inject({
    method: 'POST',
    url: `/automation/v1/actions/${c.actionId}/execute`,
    headers,
  });
  await app.inject({
    method: 'POST',
    url: `/automation/v1/actions/${c.actionId}/verify`,
    headers,
  });
  const url = `/api/v1/tickets/${c.ticketId}/effort`;
  const observation = {
    observationId: randomUUID(),
    source: 'synthetic',
    totalMinutes: 6,
    reviewMinutes: 1,
    complete: true,
    note: 'Synthetic arithmetic fixture, not measured labor.',
    baseline: {
      kind: 'synthetic',
      minutes: 5,
      reference: 'same ticket fixture/manual-v1',
    },
  };
  expect(
    (await app.inject({ method: 'POST', url, payload: observation }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({ method: 'POST', url, headers, payload: observation })
    ).json().replayed,
  ).toBe(false);
  expect(
    (
      await app.inject({ method: 'POST', url, headers, payload: observation })
    ).json().replayed,
  ).toBe(true);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { ...observation, totalMinutes: 4 },
      })
    ).statusCode,
  ).toBe(409);
  const metric = async () =>
    (await app.inject({ url: '/api/v1/metrics/outcomes', headers })).json();
  let m = await metric();
  expect(m.humanMinutesPerTicket).toBeNull();
  expect(m.humanEffort.synthetic.savings.synthetic).toEqual({
    matchedResolvedTickets: 1,
    minutesPerMatchedResolvedTicket: -1,
  });
  // Deliberate API fixture of an operator report; never publish this as measured human evidence.
  await app.inject({
    method: 'POST',
    url,
    headers,
    payload: {
      ...observation,
      observationId: randomUUID(),
      source: 'operator_reported',
      baseline: { ...observation.baseline, kind: 'measured' },
    },
  });
  m = await metric();
  expect(m.humanMinutesPerTicket).toBe(6);
  expect(m.automationRate).toBe(0);
  expect(m.estimatedHumanMinutesSaved).toBe(-1);
  await post();
  m = await metric();
  expect(m.humanMinutesPerTicket).toBeNull();
  expect(m.humanEffort.observed.observationCoverage).toBe(0.5);
  expect(m.humanEffort.observed.partialRecordedMinutesPerCohortTicket).toBe(3);
  expect(
    (
      await app.inject({ url: '/api/v1/metrics/outcomes?mode=live', headers })
    ).json().humanEffort.observed.observedTickets,
  ).toBe(0);
  // A newer cumulative snapshot replaces, rather than adds to, the older snapshot.
  await app.inject({
    method: 'POST',
    url,
    headers,
    payload: {
      ...observation,
      observationId: randomUUID(),
      source: 'operator_reported',
      totalMinutes: 8,
    },
  });
  expect((await metric()).humanEffort.observed.recordedTotalMinutes).toBe(8);
  // Any subsequent work makes the prior completeness assertion stale.
  await pool.query(
    "INSERT INTO audit_events(id,run_id,event_type,actor,evidence,created_at) VALUES($1,$2,'recovery.started','test','{}',$3)",
    [randomUUID(), c.runId, clock],
  );
  expect((await metric()).humanEffort.observed.completeTickets).toBe(0);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers,
        payload: {
          ...observation,
          observationId: randomUUID(),
          reviewMinutes: 7,
        },
      })
    ).statusCode,
  ).toBe(400);
});
test('unknown customer remains unresolved for future triage', async () => {
  const result = (await post({ ...payload, customerRef: 'MISSING' })).json();
  const ticket = (
    await app.inject({ url: `/api/v1/tickets/${result.ticketId}`, headers })
  ).json();
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
    expect(await counts()).toEqual({
      tickets: 0,
      runs: 0,
      audit: 0,
      outbox: 0,
    });
  } finally {
    await pool.query(
      'DROP TRIGGER reject_outbox ON outbox_events; DROP FUNCTION reject_outbox()',
    );
  }
});
test('unauthorized intake cannot mutate state', async () => {
  expect(
    (await app.inject({ method: 'POST', url: '/api/v1/tickets', payload }))
      .statusCode,
  ).toBe(401);
  expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
});
test.each([
  { ...payload, action: 'refund_all' },
  { ...payload, message: '   ' },
  { ...payload, message: 'x'.repeat(8001) },
  { message: 'missing customer' },
])('invalid ticket input is rejected: %j', async (body) => {
  expect((await post(body)).statusCode).toBe(400);
  expect(await counts()).toEqual({ tickets: 0, runs: 0, audit: 0, outbox: 0 });
});
test('business reads return only the requested customer payments', async () => {
  const response = await app.inject({
    url: '/integrations/v1/customers/CUSTOMER-001/payments',
    headers,
  });
  expect(
    response.json().payments.map((payment: { id: string }) => payment.id),
  ).toEqual(['PAY-001', 'PAY-002']);
  expect(
    (
      await app.inject({
        url: '/integrations/v1/customers/MISSING/payments',
        headers,
      })
    ).statusCode,
  ).toBe(404);
});
test('migrations and baseline seed can be run twice without duplication', async () => {
  await migrate(pool);
  await seed(db);
  expect(
    (await pool.query('SELECT count(*)::int AS count FROM payments')).rows[0]
      .count,
  ).toBe(3);
});
test('database rejects cross-customer payment ownership and excessive refunded amounts', async () => {
  await expect(
    pool.query(
      "UPDATE payments SET customer_id = 'CUSTOMER-002' WHERE id = 'PAY-001'",
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query(
      "UPDATE payments SET refunded_amount_minor = 3000 WHERE id = 'PAY-001'",
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
test('malformed resource IDs return a safe client error', async () => {
  expect(
    (await app.inject({ url: '/api/v1/runs/not-a-uuid', headers })).statusCode,
  ).toBe(400);
});

const classifyAndPropose = async (
  message = 'How can I download my invoice?',
) => {
  const created = (await post({ customerRef: 'CUSTOMER-001', message })).json();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/runs/${created.runId}/decision`,
        headers,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/runs/${created.runId}/policy`,
        headers,
      })
    ).statusCode,
  ).toBe(200);
  const run = (
    await app.inject({ url: `/api/v1/runs/${created.runId}`, headers })
  ).json();
  return { ...created, run, actionId: run.actions[0]?.id };
};

test('dashboard assets are public, same-origin, and do not expose API credentials', async () => {
  for (const path of [
    '/dashboard',
    '/dashboard/styles.css',
    '/dashboard/app.js',
    '/dashboard/format.js',
  ]) {
    const response = await app.inject({ url: path });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(response.body).not.toContain(token);
  }
  const html = (await app.inject({ url: '/dashboard' })).body;
  for (const label of [
    'Overview',
    'Tickets',
    'Approvals',
    'Reliability lab',
    'Outcomes',
  ])
    expect(html).toContain(label);
  expect(
    (await app.inject({ url: '/dashboard/../../.env' })).statusCode,
  ).not.toBe(200);
  expect((await app.inject({ url: '/api/v1/tickets' })).statusCode).toBe(401);
  expect(
    (await app.inject({ url: '/api/v1/metrics/outcomes' })).statusCode,
  ).toBe(401);
});

test('ticket queue, conversation and run views expose real related evidence', async () => {
  const c = await classifyAndPropose();
  await app.inject({
    method: 'POST',
    url: `/automation/v1/actions/${c.actionId}/execute`,
    headers,
  });
  await app.inject({
    method: 'POST',
    url: `/automation/v1/actions/${c.actionId}/verify`,
    headers,
  });
  const list = (await app.inject({ url: '/api/v1/tickets', headers })).json();
  expect(list.tickets[0]).toMatchObject({
    id: c.ticketId,
    customerName: 'Morgan Example',
    runId: c.runId,
    status: 'resolved',
    verifiedActions: 1,
    mode: 'FIXTURE MODE',
  });
  const ticket = (
    await app.inject({ url: `/api/v1/tickets/${c.ticketId}`, headers })
  ).json();
  expect(ticket.messages).toHaveLength(1);
  expect(ticket.runs[0].id).toBe(c.runId);
  const run = (
    await app.inject({ url: `/api/v1/runs/${c.runId}`, headers })
  ).json();
  expect(run.actions[0].businessOutcome).toBe('verified');
  expect(run.attempts).toHaveLength(1);
  expect(run.jobs[0].provider).toBe('fixture');
  expect(
    run.audit.some(
      (a: { eventType: string }) => a.eventType === 'support_response.verified',
    ),
  ).toBe(true);
});

test('review queue contains the frozen proposal and conflicting reviewers cannot both decide', async () => {
  const c = await classifyAndPropose('I was charged twice this month.');
  const list = (await app.inject({ url: '/api/v1/approvals', headers })).json();
  const approval = list.approvals[0];
  expect(approval).toMatchObject({
    status: 'pending',
    action: {
      runId: c.runId,
      parameters: { paymentId: 'PAY-002', amountMinor: 2900 },
    },
    ticket: { id: c.ticketId },
  });
  const decisions = await Promise.all(
    ['approved', 'rejected'].map((decision) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/approvals/${approval.id}/decision`,
        headers,
        payload: { decision, reason: 'Synthetic review evidence checked.' },
      }),
    ),
  );
  expect(decisions.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_type IN ('approval.approved','approval.rejected')",
      )
    ).rows[0].count,
  ).toBe(1);
});

test('concurrent refund execution uses one receipt and ordered bounded attempts', async () => {
  const c = await classifyAndPropose('I was charged twice this month.');
  await app.inject({
    method: 'POST',
    url: `/api/v1/approvals/${c.run.approvals[0].id}/decision`,
    headers,
    payload: { decision: 'approved', reason: 'Synthetic concurrency check.' },
  });
  try {
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({
          method: 'POST',
          url: `/automation/v1/actions/${c.actionId}/execute`,
          headers,
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(responses.filter((r) => !r.json().replayed)).toHaveLength(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM refunds WHERE action_id=$1',
          [c.actionId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT attempt FROM action_attempts WHERE action_id=$1 ORDER BY attempt',
          [c.actionId],
        )
      ).rows.map((r) => r.attempt),
    ).toEqual([1, 2, 3]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/automation/v1/actions/${c.actionId}/execute`,
          headers,
        })
      ).json(),
    ).toEqual({ error: 'attempt_limit' });
    const verified = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({
          method: 'POST',
          url: `/automation/v1/actions/${c.actionId}/verify`,
          headers,
        }),
      ),
    );
    expect(verified.every((r) => r.json().outcome === 'verified')).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM ticket_messages WHERE action_id=$1',
          [c.actionId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await pool.query(
      "UPDATE payments SET refunded_amount_minor=0 WHERE id='PAY-002'",
    );
  }
});

test('competing approved actions cannot refund the same payment twice', async () => {
  const cases = [
    await classifyAndPropose('I was charged twice this month.'),
    await classifyAndPropose('I was charged twice this month.'),
  ];
  for (const c of cases)
    await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${c.run.approvals[0].id}/decision`,
      headers,
      payload: { decision: 'approved', reason: 'Synthetic competing action.' },
    });
  try {
    const responses = await Promise.all(
      cases.map((c) =>
        app.inject({
          method: 'POST',
          url: `/automation/v1/actions/${c.actionId}/execute`,
          headers,
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM refunds WHERE payment_id='PAY-002'",
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await pool.query(
      "UPDATE payments SET refunded_amount_minor=0 WHERE id='PAY-002'",
    );
  }
});

test('approval expiry persists and post-approval parameter edits are rejected', async () => {
  const expired = await classifyAndPropose('I was charged twice this month.');
  const id = expired.run.approvals[0].id;
  await pool.query('UPDATE approvals SET expires_at=$1 WHERE id=$2', [
    clock,
    id,
  ]);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/approvals/${id}/decision`,
        headers,
        payload: { decision: 'approved', reason: 'Too late.' },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await pool.query('SELECT status FROM approvals WHERE id=$1', [id])).rows[0]
      .status,
  ).toBe('expired');
  const changed = await classifyAndPropose('I was charged twice this month.');
  await app.inject({
    method: 'POST',
    url: `/api/v1/approvals/${changed.run.approvals[0].id}/decision`,
    headers,
    payload: { decision: 'approved', reason: 'Original exact proposal.' },
  });
  await pool.query(
    `UPDATE proposed_actions SET parameters=jsonb_set(parameters,'{amountMinor}','1') WHERE id=$1`,
    [changed.actionId],
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/actions/${changed.actionId}/execute`,
        headers,
      })
    ).json(),
  ).toEqual({ error: 'proposal_changed' });
  expect(
    (await pool.query('SELECT count(*)::int AS n FROM refunds')).rows[0].n,
  ).toBe(0);
});

test('support receipt rejects a changed payload instead of returning false success', async () => {
  const c = await classifyAndPropose();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/actions/${c.actionId}/execute`,
        headers,
      })
    ).statusCode,
  ).toBe(200);
  await pool.query(
    `UPDATE proposed_actions SET parameters=jsonb_set(parameters,'{text}','"Changed response"') WHERE id=$1`,
    [c.actionId],
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/actions/${c.actionId}/execute`,
        headers,
      })
    ).json(),
  ).toEqual({ error: 'idempotency_conflict' });
});

test('empty metrics stay N/A and include an explicit cohort and cutoff', async () => {
  const m = (
    await app.inject({ url: '/api/v1/metrics/outcomes?mode=fixture', headers })
  ).json();
  expect(m).toMatchObject({
    mode: 'FIXTURE MODE',
    cohort: { tickets: 0, cutoff: '2026-09-13T00:00:00.000Z' },
    automationRate: null,
    verifiedCompletionRate: null,
    humanMinutesPerTicket: null,
    modelCost: null,
  });
  expect(
    (
      await app.inject({
        url: '/api/v1/metrics/outcomes?mode=combined',
        headers,
      })
    ).statusCode,
  ).toBe(400);
});

test('metrics retain pending work and exclude approved resolutions from full automation', async () => {
  const support = await classifyAndPropose();
  await app.inject({
    method: 'POST',
    url: `/automation/v1/actions/${support.actionId}/execute`,
    headers,
  });
  await app.inject({
    method: 'POST',
    url: `/automation/v1/actions/${support.actionId}/verify`,
    headers,
  });
  const refund = await classifyAndPropose('I was charged twice this month.');
  const approvalId = refund.run.approvals[0].id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/approvals/${approvalId}/decision`,
    headers,
    payload: {
      decision: 'approved',
      reason: 'Checked exact synthetic duplicate payment.',
    },
  });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/automation/v1/actions/${refund.actionId}/execute`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/automation/v1/actions/${refund.actionId}/verify`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    await post({
      customerRef: 'CUSTOMER-002',
      message: 'An unprocessed ticket.',
    });
    const m = (
      await app.inject({ url: '/api/v1/metrics/outcomes', headers })
    ).json();
    expect(m.cohort.tickets).toBe(3);
    expect(m.automationRate).toBeCloseTo(1 / 3);
    expect(m.verifiedCompletionRate).toBeCloseTo(2 / 3);
    expect(m.reliability.attemptedActions).toBe(2);
    expect(m.humanMinutesPerTicket).toBeNull();
  } finally {
    await pool.query(
      "UPDATE payments SET refunded_amount_minor=0 WHERE id='PAY-002'",
    );
  }
});

test('legacy mode mistakes are corrected by provider metadata without mixing cohorts', async () => {
  const c = await classifyAndPropose();
  // A synthetic stored record represents historical live metadata; no model is called.
  await pool.query(
    "UPDATE ai_jobs SET provider='codex', model='synthetic-live-test' WHERE run_id=$1",
    [c.runId],
  );
  await post();
  const fixture = (
    await app.inject({ url: '/api/v1/metrics/outcomes?mode=fixture', headers })
  ).json();
  const live = (
    await app.inject({ url: '/api/v1/metrics/outcomes?mode=live', headers })
  ).json();
  expect(fixture.cohort.tickets).toBe(1);
  expect(live.cohort.tickets).toBe(1);
  expect(
    (await app.inject({ url: `/api/v1/runs/${c.runId}`, headers })).json().mode,
  ).toBe('LIVE AI MODE');
});

test('live intake records mode before inference and the failure lab is fixture-only', async () => {
  const fixture = new FixtureProvider();
  const live = buildApp({
    db,
    token,
    provider: {
      mode: 'LIVE AI MODE',
      provider: 'codex',
      model: 'synthetic-test',
      classify: fixture.classify.bind(fixture),
    },
  });
  try {
    const created = await live.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers,
      payload,
    });
    expect(created.json().mode).toBe('LIVE AI MODE');
    const scenario = await live.inject({
      method: 'POST',
      url: '/api/v1/scenarios/false-success/start',
      headers,
      payload: {},
    });
    expect(scenario.statusCode).toBe(409);
    expect(scenario.json().error).toBe('fixture_mode_required');
    expect((await counts()).tickets).toBe(1);
  } finally {
    await live.close();
  }
});

test('browser reliability experiments create support tickets with persisted faults', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/scenarios/false-success/start',
    headers,
    payload: {
      customerRef: 'CUSTOMER-001',
      message: 'How can I download my invoice?',
    },
  });
  expect(response.statusCode).toBe(201);
  const runId = response.json().runId;
  await app.inject({
    method: 'POST',
    url: `/automation/v1/runs/${runId}/decision`,
    headers,
  });
  await app.inject({
    method: 'POST',
    url: `/automation/v1/runs/${runId}/policy`,
    headers,
  });
  const run = (
    await app.inject({ url: `/api/v1/runs/${runId}`, headers })
  ).json();
  expect(run.scenarios[0].fixtureId).toBe('false-success');
  const actionId = run.actions[0].id;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/actions/${actionId}/execute`,
        headers,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/automation/v1/actions/${actionId}/verify`,
        headers,
      })
    ).json().outcome,
  ).toBe('failed');
  expect(
    (
      await app.inject({
        url: `/api/v1/tickets/${response.json().ticketId}`,
        headers,
      })
    ).json().messages,
  ).toHaveLength(0);
});

test('a failure to persist the scenario rolls back intake before an outbox worker can observe it', async () => {
  await pool.query(`CREATE FUNCTION reject_scenario() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected scenario failure'; END $$;
    CREATE TRIGGER reject_scenario BEFORE INSERT ON scenario_instances FOR EACH ROW EXECUTE FUNCTION reject_scenario();`);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios/false-success/start',
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(await counts()).toEqual({
      tickets: 0,
      runs: 0,
      audit: 0,
      outbox: 0,
    });
  } finally {
    await pool.query(
      'DROP TRIGGER reject_scenario ON scenario_instances; DROP FUNCTION reject_scenario()',
    );
  }
});
