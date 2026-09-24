import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { OPERATOR_TOKEN } from './support/constants.js';

// Navigate the actual tab order: no click(), focus(), fill() or API mutations.
async function tabTo(page: Page, target: Locator, backwards = false) {
  await expect(target).toBeVisible();
  const visited: string[] = [];
  for (let count = 0; count < 64; count++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      await expect(target).toBeInViewport();
      return;
    }
    // macOS WebKit offers Option-Tab for all controls without changing OS preferences.
    const tab =
      process.platform === 'darwin' && test.info().project.name === 'webkit'
        ? 'Alt+Tab'
        : 'Tab';
    await page.keyboard.press(backwards ? `Shift+${tab}` : tab);
    visited.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName}#${el?.id}[${el?.getAttribute('data-action') ?? ''}]`;
      }),
    );
  }
  throw new Error(
    `Control was not reachable through the keyboard tab order: ${visited.join(', ')}`,
  );
}
async function activate(page: Page, target: Locator, backwards = false) {
  await tabTo(page, target, backwards);
  await page.keyboard.press('Enter');
}

for (const scenario of ['invoice', 'refund'] as const) {
  test(`keyboard-only ${scenario} journey reaches a verified destination outcome`, async ({
    page,
    lab,
    ui,
  }) => {
    await ui.open();
    await activate(
      page,
      page
        .getByRole('banner')
        .getByRole('button', { name: 'Connect workspace', exact: true }),
      true, // Routes start focus in main; the header precedes it.
    );
    const dialog = page.getByRole('dialog');
    await tabTo(
      page,
      dialog.getByLabel('Local operator token', { exact: true }),
    );
    await page.keyboard.type(OPERATOR_TOKEN);
    await activate(
      page,
      dialog.getByRole('button', { name: /^Connect workspace/ }),
    );
    await expect(dialog).not.toBeVisible();
    await activate(
      page,
      page.getByRole('button', { name: /New ticket/ }).first(),
    );
    await tabTo(page, dialog.getByLabel('Customer message', { exact: true }));
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(
      scenario === 'invoice'
        ? 'How can I download my invoice?'
        : 'I was charged twice this month.',
    );
    await tabTo(page, dialog.getByRole('checkbox'));
    await page.keyboard.press('Space');
    const createdResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/tickets') && r.request().method() === 'POST',
    );
    await activate(
      page,
      dialog.getByRole('button', { name: /^Create ticket/ }),
    );
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const { ticketId } = (await created.json()) as { ticketId: string };
    await expect(dialog).not.toBeVisible();

    if (scenario === 'refund') {
      const pending = await lab.waitFor(
        ticketId,
        (s) => s.approvals.length === 1,
        'reviewable frozen proposal',
      );
      expect(pending.refunds).toHaveLength(0);
      await activate(
        page,
        page.getByRole('navigation').getByRole('link', { name: /Approvals/ }),
        true,
      );
      await activate(
        page,
        page.getByRole('button', { name: /Review proposal/ }),
      );
      await expect(dialog).toContainText('PAY-002');
      await expect(dialog).toContainText('$29.00');
      const decision = dialog.getByLabel('Your decision', { exact: true });
      await tabTo(page, decision);
      await page.keyboard.press('a');
      await page.keyboard.press('Tab');
      await expect(decision).toHaveValue('approved');
      await tabTo(
        page,
        dialog.getByLabel('Reason for your decision', { exact: true }),
      );
      await page.keyboard.type(
        'Synthetic keyboard regression: exact duplicate payment checked.',
      );
      await tabTo(page, dialog.getByRole('checkbox'));
      await page.keyboard.press('Space');
      await activate(
        page,
        dialog.getByRole('button', { name: 'Record decision', exact: true }),
      );
      await expect(dialog).not.toBeVisible();
    }
    const outcome = await lab.waitFor(
      ticketId,
      (s) => s.ticket.status === 'resolved',
      'independently verified destination',
    );
    expect(outcome.actions).toHaveLength(1);
    expect(outcome.actions[0]?.business_outcome).toBe('verified');
    expect(outcome.receipts).toHaveLength(1);
    expect(outcome.messages).toHaveLength(1);
    expect(outcome.refunds).toHaveLength(scenario === 'refund' ? 1 : 0);
  });
}
