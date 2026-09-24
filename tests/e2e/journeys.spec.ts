import { test, expect } from './fixtures.js';

test.beforeEach(async ({ ui }) => {
  await ui.open();
  await ui.connect();
});

test('invoice ticket → real n8n → one verified destination response', async ({
  ui,
  page,
  lab,
}) => {
  const ticket = await ui.ticket();
  const state = await lab.waitFor(
    ticket.ticketId,
    (s) => s.ticket.status === 'resolved',
    'n8n must independently verify support delivery',
  );
  expect(state.messages).toEqual([
    expect.objectContaining({
      text: 'You can download invoices from Settings → Billing → Invoices.',
      visibility: 'customer',
    }),
  ]);
  expect(state.actions).toHaveLength(1);
  expect(state.actions[0]?.business_outcome).toBe('verified');
  expect(state.receipts).toHaveLength(1);
  expect(state.jobs).toEqual([{ provider: 'fixture', status: 'completed' }]);
  expect(state.workflows).toEqual([{ technical_status: 'completed' }]);
  await ui.inspectRun();
  await expect(
    page.getByText('verified', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByText('Parameters, authorization key & action state', { exact: true })
    .click();
  await expect(page.getByRole('main')).toContainText(
    state.actions[0]!.idempotency_key,
  );
  await page.getByRole('link', { name: /Back to ticket/ }).click();
  await expect(
    page.getByText(state.messages[0]!.text, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('resolved', { exact: true }).first(),
  ).toBeVisible();
});

test('pending intake is not displayed as completed when the worker is paused', async ({
  ui,
  page,
  lab,
}) => {
  await lab.control('/__e2e/worker', { paused: true });
  const ticket = await ui.ticket();
  const state = await lab.oracle(ticket.ticketId);
  expect(state.actions).toHaveLength(0);
  expect(state.messages).toHaveLength(0);
  await expect(
    page.getByText(/No destination response is recorded yet/),
  ).toBeVisible();
  await ui.inspectRun();
  await expect(
    page.getByText('No provider call is recorded yet.', { exact: true }),
  ).toBeVisible();
  await lab.control('/__e2e/worker', { paused: false });
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.ticket.status === 'resolved',
    'resumed worker resolves the same ticket',
  );
  await ui.refresh();
  await expect(
    page.getByText('verified', { exact: true }).first(),
  ).toBeVisible();
});

for (const decision of ['approved', 'rejected'] as const) {
  test(`duplicate charge → explicit human ${decision} → auditable outcome`, async ({
    ui,
    page,
    lab,
  }) => {
    const ticket = await ui.ticket('duplicate');
    const before = await lab.waitFor(
      ticket.ticketId,
      (s) => s.approvals.length === 1,
      'refund policy creates an approval',
    );
    expect(before.refunds).toHaveLength(0);
    expect(before.attempts).toHaveLength(0);
    expect(before.actions[0]?.status).toBe('pending_approval');
    const reason = `Synthetic reviewer ${decision}: checked invoice, duplicate payment, and exact amount.`;
    await ui.review(decision, reason);
    const after = await lab.waitFor(
      ticket.ticketId,
      (s) =>
        decision === 'approved'
          ? s.ticket.status === 'resolved'
          : s.actions[0]?.status === 'rejected',
      'reviewed action reaches its permitted outcome',
    );
    expect(after.approvals[0]).toMatchObject({
      status: decision,
      decision_reason: reason,
    });
    expect(
      after.audit.filter((a) => a.event_type === `approval.${decision}`),
    ).toHaveLength(1);
    if (decision === 'approved') {
      expect(after.refunds).toEqual([
        expect.objectContaining({
          payment_id: 'PAY-002',
          amount_minor: 2900,
          status: 'completed',
        }),
      ]);
      expect(
        after.payments.find((p) => p.id === 'PAY-002')?.refunded_amount_minor,
      ).toBe(2900);
      expect(after.actions[0]?.business_outcome).toBe('verified');
      expect(after.messages).toHaveLength(1);
    } else {
      expect(after.refunds).toHaveLength(0);
      expect(after.messages).toHaveLength(0);
      expect(after.payments.every((p) => p.refunded_amount_minor === 0)).toBe(
        true,
      );
      expect(after.actions[0]?.business_outcome).toBe('not_performed');
    }
    await page
      .getByRole('button', { name: 'Decision history', exact: true })
      .click();
    await expect(
      page.getByText(`Reviewer reason: ${reason}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Review proposal/ }),
    ).toHaveCount(0);
  });
}

test('review requires a decision, reason, and explicit confirmation; cancel makes no change', async ({
  ui,
  page,
  lab,
}) => {
  const ticket = await ui.ticket('duplicate');
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.approvals.length === 1,
    'approval appears',
  );
  await ui.navigate('Approvals');
  await page.getByRole('button', { name: /Review proposal/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Record decision', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel('Your decision', { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel('Your decision', { exact: true })
    .selectOption('approved');
  await dialog
    .getByRole('button', { name: 'Record decision', exact: true })
    .click();
  await expect(
    dialog.getByLabel('Reason for your decision', { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel('Reason for your decision', { exact: true })
    .fill('Synthetic check.');
  await dialog
    .getByRole('button', { name: 'Record decision', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const state = await lab.oracle(ticket.ticketId);
  expect(state.approvals[0]?.status).toBe('pending');
  expect(state.refunds).toHaveLength(0);
});

test('a proposal that expires while open is rejected by the backend, not falsely confirmed', async ({
  ui,
  page,
  lab,
}) => {
  const ticket = await ui.ticket('duplicate');
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.approvals.length === 1,
    'approval appears',
  );
  await ui.navigate('Approvals');
  await page.getByRole('button', { name: /Review proposal/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Your decision', { exact: true })
    .selectOption('approved');
  await dialog
    .getByLabel('Reason for your decision', { exact: true })
    .fill('Synthetic stale-review test.');
  await dialog.getByRole('checkbox').check();
  const clock = await lab.control<{ now: string }>('/__e2e/clock', {
    advanceSeconds: 25 * 3600,
  });
  await dialog
    .getByRole('button', { name: 'Record decision', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'This approval has expired. No decision was recorded.',
  );
  expect((await lab.oracle(ticket.ticketId)).refunds).toHaveLength(0);
  await page.clock.setFixedTime(new Date(clock.now));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await ui.refresh();
  await page
    .getByRole('button', { name: 'Decision history', exact: true })
    .click();
  await expect(page.getByText('expired', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Review proposal/ }),
  ).toHaveCount(0);
});

for (const [preset, customer, status, reason] of [
  ['account', 'CUSTOMER-001', 'human_follow_up', 'account_plan_mismatch'],
  ['invoice', 'MISSING-CUSTOMER', 'human_follow_up', 'customer_identity'],
  ['ambiguous', 'CUSTOMER-001', 'awaiting_customer', null],
] as const) {
  test(`${preset} / ${customer} routes to ${status} without an unauthorized action`, async ({
    ui,
    page,
    lab,
  }) => {
    const ticket = await ui.ticket(preset, { customer });
    const state = await lab.waitFor(
      ticket.ticketId,
      (s) => s.ticket.status === status,
      'bounded backend policy determines the route',
    );
    expect(state.actions).toHaveLength(0);
    expect(state.refunds).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.run.escalation_reason).toBe(reason);
    await ui.inspectRun();
    await expect(
      page.getByText(/No executable action was proposed/),
    ).toBeVisible();
    await ui.navigate('Tickets');
    await expect(page.getByRole('table')).toContainText(
      status.replaceAll('_', ' '),
    );
  });
}

const faults = [
  [
    'Failure before the write',
    'verified',
    ['failed_before_commit', 'committed'],
  ],
  [
    'The response goes missing',
    'verified',
    ['committed_response_lost', 'idempotent_replay'],
  ],
  ['A convincing false success', 'failed', ['success_without_mutation']],
  ['When the answer is unknown', 'unknown', ['committed']],
] as const;
for (const [title, outcome, attempts] of faults) {
  test(`reliability lab: ${title}`, async ({ ui, page, lab }) => {
    await ui.navigate('Reliability lab');
    await page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      .getByRole('button', { name: /Configure experiment/ })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    const response = page.waitForResponse(
      (r) => r.url().includes('/scenarios/') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: /Run experiment/ }).click();
    const result = await response;
    expect(result.status()).toBe(201);
    const created = (await result.json()) as {
      ticketId: string;
      runId: string;
    };
    await expect(page).toHaveURL(new RegExp(`#run/${created.runId}$`));
    const state = await lab.waitFor(
      created.ticketId,
      (s) => s.actions[0]?.business_outcome === outcome,
      'actual destination verifier determines the fault outcome',
    );
    expect(state.attempts.map((a) => a.result)).toEqual([...attempts]);
    expect(state.messages).toHaveLength(outcome === 'failed' ? 0 : 1);
    expect(state.receipts).toHaveLength(outcome === 'failed' ? 0 : 1);
    await ui.refresh();
    await expect(
      page.getByText(outcome, { exact: true }).first(),
    ).toBeVisible();
    if (outcome === 'unknown') {
      const reconciliation = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/runs/${created.runId}/reconcile`) &&
          r.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: 'Reconcile outcome', exact: true })
        .click();
      expect(
        (await reconciliation).status(),
        'UI reconciliation must send an API-valid request',
      ).toBe(200);
      await expect(
        page.getByRole('button', { name: 'Reconcile outcome', exact: true }),
      ).toHaveCount(0);
      const recovered = await lab.oracle(created.ticketId);
      expect(recovered.ticket.status).toBe('resolved');
      expect(recovered.actions[0]?.business_outcome).toBe('verified');
      expect(recovered.attempts).toHaveLength(1);
      expect(recovered.messages).toHaveLength(1);
      await expect(
        page.getByText('verified', { exact: true }).first(),
      ).toBeVisible();
    }
    if (outcome === 'failed') {
      expect(state.ticket.status).toBe('open');
      await expect(page.getByText('verified', { exact: true })).toHaveCount(0);
    }
  });
}

test('outcomes distinguish approved work from automation and keep live/effort evidence honest', async ({
  ui,
  page,
  lab,
}) => {
  const support = await ui.ticket();
  await lab.waitFor(
    support.ticketId,
    (s) => s.ticket.status === 'resolved',
    'support resolves',
  );
  const refund = await ui.ticket('duplicate');
  await lab.waitFor(
    refund.ticketId,
    (s) => s.approvals.length === 1,
    'approval appears',
  );
  await ui.review('approved', 'Synthetic cohort review.');
  await lab.waitFor(
    refund.ticketId,
    (s) => s.ticket.status === 'resolved',
    'approved refund verifies',
  );
  await ui.navigate('Outcomes');
  const card = (label: string) =>
    page.getByRole('article').filter({ hasText: label });
  await expect(card('Tickets in cohort')).toContainText('2');
  await expect(card('Verified completion')).toContainText('100%');
  await expect(card('Fully automated')).toContainText('50%');
  await expect(page.getByText(/N\/A means missing evidence/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Live AI results', exact: true })
    .click();
  await expect(card('Tickets in cohort')).toContainText('0');
  await expect(card('Verified completion')).toContainText('N/A');
  await expect(page.getByRole('banner')).toContainText('FIXTURE MODE');
});
