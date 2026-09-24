import { test, expect } from './fixtures.js';
import { OPERATOR_TOKEN } from './support/constants.js';

test('late readiness cannot reconnect a cancelled session or close a new dialog', async ({ ui, page }) => {
  await ui.open();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/readyz', async (route) => { await held; await route.continue(); });
  const opener = page.getByRole('banner').getByRole('button', { name: 'Connect workspace', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Local operator token', { exact: true }).fill(OPERATOR_TOKEN);
  const request = page.waitForRequest('**/readyz');
  await dialog.getByRole('button', { name: /^Connect workspace/ }).click();
  await request;
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  const response = page.waitForResponse('**/readyz');
  release();
  expect((await response).status()).toBe(200);
  await expect(dialog.getByLabel('Local operator token', { exact: true })).toHaveValue('');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  await page.unroute('**/readyz');
  await page.keyboard.press('Escape');
  await ui.connect();
});

test('disconnect during a pending read clears loading semantics and private content', async ({ ui, page }) => {
  await ui.open();
  await ui.connect();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/tickets', async (route) => { await held; await route.continue().catch(() => {}); });
  await page.getByRole('navigation').getByRole('link', { name: /Tickets/ }).click();
  await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Loading workspace evidence' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  release();
  await expect(page.getByRole('main')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: 'Good automation leaves evidence.' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('skip navigation preserves the active screen and moves keyboard focus to main', async ({ ui, page }) => {
  await ui.open();
  await ui.connect();
  await ui.navigate('Tickets');
  const skip = page.getByRole('link', { name: 'Skip to workspace', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#tickets$/);
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Ticket workspace' })).toBeVisible();
});

test('welcome, invalid credentials, connection, logout and reload respect session boundaries', async ({
  ui,
  page,
}) => {
  await ui.open();
  await expect(
    page.getByRole('heading', { name: 'Good automation leaves evidence.' }),
  ).toBeVisible();
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Connect workspace', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Local operator token', { exact: true })
    .fill('invalid-disposable-test-token-000000000');
  await dialog.getByRole('button', { name: /^Connect workspace/ }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Session not authorized',
  );
  await expect(
    page.getByRole('heading', { name: 'Good automation leaves evidence.' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await ui.connect();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(await page.content()).not.toContain(OPERATOR_TOKEN);
  expect(page.url()).not.toContain(OPERATOR_TOKEN);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Good automation leaves evidence.' }),
  ).toBeVisible();
  await ui.connect();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Good automation leaves evidence.' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('native ticket validation prevents empty, invalid-reference and unconfirmed submissions', async ({
  ui,
  page,
  lab,
}) => {
  await ui.open();
  await ui.connect();
  await ui.navigate('Tickets');
  await page
    .getByRole('button', { name: /New ticket/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/tickets')) posts++;
  });
  await dialog
    .getByLabel('Customer reference', { exact: true })
    .fill('bad reference /');
  expect
    .soft(
      await dialog
        .getByLabel('Customer reference', { exact: true })
        .evaluate(
          (input) => (input as HTMLInputElement).validity.patternMismatch,
        ),
      'The customer-reference pattern must be valid in modern browsers and reject spaces/slashes',
    )
    .toBe(true);
  await dialog.getByRole('button', { name: /^Create ticket/ }).click();
  await dialog
    .getByLabel('Customer reference', { exact: true })
    .fill('CUSTOMER-001');
  await dialog.getByLabel('Customer message', { exact: true }).fill('');
  await dialog.getByRole('button', { name: /^Create ticket/ }).click();
  await expect(
    dialog.getByLabel('Customer message', { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel('Customer message', { exact: true })
    .fill('How can I download my invoice?');
  await dialog.getByRole('button', { name: /^Create ticket/ }).click();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog).toBeVisible();
  expect(posts).toBe(0);
  const queue = await lab.control<{ tickets: unknown[] }>('/api/v1/tickets');
  expect(queue.tickets).toHaveLength(0);
});

test('search, status filters and empty results operate on actual tickets', async ({
  ui,
  page,
  lab,
}) => {
  await ui.open();
  await ui.connect();
  const support = await ui.ticket();
  await lab.waitFor(
    support.ticketId,
    (s) => s.ticket.status === 'resolved',
    'support resolves',
  );
  const escalation = await ui.ticket('account');
  await lab.waitFor(
    escalation.ticketId,
    (s) => s.ticket.status === 'human_follow_up',
    'account request escalates',
  );
  await ui.navigate('Tickets');
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('table')).toContainText('download my invoice');
  await page.getByRole('button', { name: 'Escalated', exact: true }).click();
  await expect(page.getByRole('table')).toContainText(
    'My account still says Free',
  );
  await page
    .getByLabel('Search loaded tickets', { exact: true })
    .fill('not-present-in-any-ticket');
  await expect(
    page.getByRole('heading', { name: 'No matching tickets' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Search loaded tickets', { exact: true }),
  ).toBeFocused();
  await page.getByLabel('Search loaded tickets', { exact: true }).fill('');
  await page.getByRole('button', { name: 'All tickets', exact: true }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
});

test('untrusted ticket text stays text in queue, conversation and evidence', async ({
  ui,
  page,
  lab,
}) => {
  await ui.open();
  await ui.connect();
  const attack =
    '<img src=x onerror="window.__e2eInjected=true"> <script>window.__e2eInjected=true</script> & synthetic support';
  const ticket = await ui.ticket('custom', { message: attack });
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.ticket.status === 'human_follow_up',
    'unsupported input escalates safely',
  );
  await expect(page.getByText(attack, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => Object.hasOwn(window, '__e2eInjected')),
  ).toBe(false);
  await expect(page.locator('[onerror]')).toHaveCount(0);
  await ui.navigate('Tickets');
  await expect(
    page.getByRole('link', { name: attack, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: attack, exact: true }).click();
  await ui.inspectRun();
  expect(
    await page.evaluate(() => Object.hasOwn(window, '__e2eInjected')),
  ).toBe(false);
});

test('failed reads show a recoverable error, not zero-valued success metrics', async ({
  ui,
  page,
}) => {
  await ui.open();
  await ui.connect();
  // Only transport failure is simulated. Successful business flows are never fulfilled by mocks.
  await page.route('**/api/v1/tickets', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"test_unavailable"}',
    }),
  );
  await ui.navigate('Tickets');
  await expect(
    page.getByRole('heading', { name: 'Evidence is unavailable.' }),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.unroute('**/api/v1/tickets');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ticket workspace' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your first ticket starts here' }),
  ).toBeVisible();
});

test('failed writes retain entered text and never announce ticket creation', async ({
  ui,
  page,
  lab,
}) => {
  await ui.open();
  await ui.connect();
  await ui.navigate('Tickets');
  await page
    .getByRole('button', { name: /New ticket/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Customer message', { exact: true })
    .fill('My synthetic input must survive this error.');
  await dialog.getByRole('checkbox').check();
  await page.route('**/api/v1/tickets', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"test_unavailable"}',
        })
      : route.continue(),
  );
  await dialog.getByRole('button', { name: /^Create ticket/ }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'No success is assumed',
  );
  await expect(
    dialog.getByLabel('Customer message', { exact: true }),
  ).toHaveValue('My synthetic input must survive this error.');
  await expect(
    dialog.getByRole('button', { name: /^Create ticket/ }),
  ).toBeEnabled();
  expect(
    (await lab.control<{ tickets: unknown[] }>('/api/v1/tickets')).tickets,
  ).toHaveLength(0);
});

test('deep links require reconnect after reload and preserve the requested ticket', async ({
  ui,
  page,
  lab,
}) => {
  await ui.open();
  await ui.connect();
  const ticket = await ui.ticket();
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.ticket.status === 'resolved',
    'support resolves',
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Good automation leaves evidence.' }),
  ).toBeVisible();
  await ui.connect();
  await expect(page).toHaveURL(new RegExp(`#ticket/${ticket.ticketId}$`));
  await expect(
    page.getByRole('heading', { name: 'Conversation', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('resolved', { exact: true }).first(),
  ).toBeVisible();
  // A fragment-only navigation retains the existing session; it is not a reload.
  await page.goto('/dashboard#run/00000000-0000-4000-8000-000000000000');
  await expect(
    page.getByRole('heading', { name: 'Evidence is unavailable.' }),
  ).toBeVisible();
  await expect(
    page.getByText('This record was not found in the current local database.', {
      exact: true,
    }),
  ).toBeVisible();
});

test('shell uses a restrictive CSP and keeps private reads behind authentication', async ({
  page,
  request,
}) => {
  const response = await page.goto('/dashboard');
  expect(response?.headers()['content-security-policy']).toContain(
    "script-src 'self'",
  );
  expect(response?.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  for (const path of [
    '/api/v1/tickets',
    '/api/v1/approvals',
    '/api/v1/metrics/outcomes',
  ])
    expect((await request.get(path)).status()).toBe(401);
  expect((await request.get('/dashboard/../../.env')).status()).not.toBe(200);
});
