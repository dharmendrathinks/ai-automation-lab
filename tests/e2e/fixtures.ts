import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { FIXTURE_CLOCK, OPERATOR_TOKEN } from './support/constants.js';

export type Oracle = {
  ticket: { id: string; status: string; message: string };
  run: {
    id: string;
    mode: string;
    escalation_reason: string | null;
    outcome: string;
  };
  actions: Array<{
    id: string;
    status: string;
    business_outcome: string;
    parameters: Record<string, unknown>;
    idempotency_key: string;
  }>;
  approvals: Array<{
    id: string;
    status: string;
    decision_reason: string | null;
  }>;
  messages: Array<{ text: string; visibility: string }>;
  refunds: Array<{ payment_id: string; amount_minor: number; status: string }>;
  payments: Array<{ id: string; refunded_amount_minor: number }>;
  receipts: Array<{ idempotency_key: string; request_hash: string }>;
  attempts: Array<{ result: string; attempt: number }>;
  audit: Array<{ event_type: string; evidence: Record<string, unknown> }>;
  jobs: Array<{ provider: string; status: string }>;
  workflows: Array<{ technical_status: string }>;
  outbox: Array<{ status: string; event_type: string }>;
};
export class Lab {
  constructor(readonly request: APIRequestContext) {}
  async control<T>(path: string, data?: object): Promise<T> {
    const options = {
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      timeout: 40_000,
    };
    const result =
      data === undefined
        ? await this.request.get(path, options)
        : await this.request.post(path, { ...options, data });
    expect(result.ok(), `Test control ${path}: HTTP ${result.status()}`).toBe(
      true,
    );
    return result.json() as Promise<T>;
  }
  oracle(ticketId: string) {
    return this.control<Oracle>(`/__e2e/oracle/${ticketId}`);
  }
  async waitFor(
    ticketId: string,
    predicate: (state: Oracle) => boolean,
    description: string,
  ) {
    await expect
      .poll(async () => predicate(await this.oracle(ticketId)), {
        message: description,
        timeout: 30_000,
        intervals: [100, 250, 500],
      })
      .toBe(true);
    return this.oracle(ticketId);
  }
}
export class Workspace {
  constructor(readonly page: Page) {}
  async open() {
    await this.page.goto('/dashboard');
    await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  async connect() {
    await this.page
      .getByRole('banner')
      .getByRole('button', { name: 'Connect workspace', exact: true })
      .click();
    const dialog = this.page.getByRole('dialog');
    await dialog
      .getByLabel('Local operator token', { exact: true })
      .fill(OPERATOR_TOKEN);
    await dialog.getByRole('button', { name: /^Connect workspace/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      this.page
        .getByRole('banner')
        .getByRole('button', { name: 'Disconnect', exact: true }),
    ).toBeVisible();
    await expect(this.page.getByRole('main')).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  }
  async navigate(name: string) {
    await this.page
      .getByRole('navigation')
      .getByRole('link', { name: new RegExp(name) })
      .click();
    await expect(this.page.getByRole('main')).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  }
  async refresh() {
    await this.page.getByRole('button', { name: /Refresh/ }).click();
    await expect(this.page.getByRole('main')).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  }
  async ticket(
    preset = 'invoice',
    options: { message?: string; customer?: string } = {},
  ) {
    await this.navigate('Tickets');
    await this.page
      .getByRole('button', { name: /New ticket/ })
      .first()
      .click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByLabel('Start from an example').selectOption(preset);
    if (options.message !== undefined)
      await dialog
        .getByLabel('Customer message', { exact: true })
        .fill(options.message);
    if (options.customer !== undefined)
      await dialog
        .getByLabel('Customer reference', { exact: true })
        .fill(options.customer);
    await dialog.getByRole('checkbox').check();
    const response = this.page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/tickets') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: /^Create ticket/ }).click();
    const result = await response;
    expect(result.status()).toBe(201);
    const created = (await result.json()) as {
      ticketId: string;
      runId: string;
    };
    await expect(this.page).toHaveURL(
      new RegExp(`#ticket/${created.ticketId}$`),
    );
    await expect(
      this.page.getByRole('heading', { name: 'Conversation', exact: true }),
    ).toBeVisible();
    return created;
  }
  async inspectRun() {
    await this.page.getByRole('link', { name: /Inspect run/ }).click();
    await expect(
      this.page.getByRole('heading', { name: 'Follow the evidence.' }),
    ).toBeVisible();
  }
  async review(decision: 'approved' | 'rejected', reason: string) {
    await this.navigate('Approvals');
    await this.page.getByRole('button', { name: /Review proposal/ }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toContainText('PAY-002');
    await expect(dialog).toContainText('$29.00');
    await dialog
      .getByLabel('Your decision', { exact: true })
      .selectOption(decision);
    await dialog
      .getByLabel('Reason for your decision', { exact: true })
      .fill(reason);
    await dialog.getByRole('checkbox').check();
    await dialog
      .getByRole('button', { name: 'Record decision', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  }
}

export const test = base.extend<{ lab: Lab; ui: Workspace }>({
  baseURL: async ({}, use) => {
    const url = process.env.RELAYDESK_E2E_BASE_URL;
    if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
      throw new Error(
        'Use the E2E global setup; an existing server cannot be targeted.',
      );
    await use(url);
  },
  lab: async ({ request }, use) => {
    const lab = new Lab(request);
    const identity = await lab.control<{ instance: string; mode: string }>(
      '/__e2e/identity',
    );
    expect(identity).toEqual({
      instance: process.env.RELAYDESK_E2E_INSTANCE,
      mode: 'FIXTURE MODE',
    });
    await lab.control('/__e2e/reset', {});
    await use(lab);
  },
  page: async ({ page, lab, baseURL }, use) => {
    // Depend on reset before navigation; keep browser dates aligned with deterministic business fixtures.
    void lab;
    await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
    const errors: string[] = [],
      external: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseURL) {
        external.push(url.origin);
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use(page);
    expect(errors, 'Uncaught browser errors').toEqual([]);
    expect(
      external,
      'The workspace must not contact external services',
    ).toEqual([]);
  },
  ui: async ({ page }, use) => {
    await use(new Workspace(page));
  },
});
export { expect };
