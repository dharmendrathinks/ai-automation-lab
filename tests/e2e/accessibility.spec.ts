import { AxeBuilder } from '@axe-core/playwright';
import { test, expect } from './fixtures.js';
import type { Page, TestInfo } from '@playwright/test';

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length)
    await test
      .info()
      .attach(`axe-violations-${test.info().attachments.length}`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
  // Soft assertions still fail the test, but let subsequent layout/focus checks and screenshots run.
  expect
    .soft(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => n.target),
      })),
      'WCAG A/AA violations; do not disable a rule to hide an application defect',
    )
    .toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('welcome is accessible; keyboard excludes background controls and escapes the connect dialog', async ({
  ui,
  page,
}, info) => {
  await ui.open();
  await accessible(page);
  const opener = page
    .getByRole('banner')
    .getByRole('button', { name: 'Connect workspace', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel('Local operator token', { exact: true }),
  ).toBeFocused();
  await accessible(page);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    // Native dialogs may Tab to browser chrome (BODY + document.hasFocus() false).
    // That is not a background-page focus leak; real page controls must stay inert.
    expect(
      await dialog.evaluate(
        (el) =>
          el.contains(document.activeElement) ||
          (!document.hasFocus() && document.activeElement === document.body),
      ),
    ).toBe(true);
  }
  for (
    let i = 0;
    i < 3 && !(await page.evaluate(() => document.hasFocus()));
    i++
  )
    await page.keyboard.press('Tab');
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await capture(page, info, 'connect-dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

for (const name of [
  'Overview',
  'Tickets',
  'Approvals',
  'Reliability lab',
  'Outcomes',
]) {
  test(`${name}: accessible and no page-level overflow at desktop, tablet and mobile widths`, async ({
    ui,
    page,
  }, info) => {
    await ui.open();
    await ui.connect();
    await ui.navigate(name);
    await accessible(page);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          { message: `${name} overflows at ${width}px` },
        )
        .toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
      await capture(
        page,
        info,
        `${name.toLowerCase().replaceAll(' ', '-')}-${width}`,
      );
    }
  });
}

test('populated ticket, conversation, run evidence and expanded audit are accessible', async ({
  ui,
  page,
  lab,
}, info) => {
  await ui.open();
  await ui.connect();
  const ticket = await ui.ticket();
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.ticket.status === 'resolved',
    'support resolves',
  );
  await ui.navigate('Tickets');
  await accessible(page);
  await capture(page, info, 'populated-tickets');
  await page
    .getByRole('link', { name: 'How can I download my invoice?', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Conversation' }),
  ).toBeVisible();
  await accessible(page);
  await capture(page, info, 'conversation');
  await ui.inspectRun();
  await page.getByText('Full decision contract', { exact: true }).click();
  await accessible(page);
  await capture(page, info, 'run-evidence');
});

test('create and approval dialogs expose labeled controls and accessible frozen proposal details', async ({
  ui,
  page,
  lab,
}, info) => {
  await ui.open();
  await ui.connect();
  await page
    .getByRole('button', { name: /New ticket/ })
    .first()
    .click();
  await accessible(page);
  await capture(page, info, 'create-ticket-dialog');
  await page.keyboard.press('Escape');
  const ticket = await ui.ticket('duplicate');
  await lab.waitFor(
    ticket.ticketId,
    (s) => s.approvals.length === 1,
    'approval appears',
  );
  await ui.navigate('Approvals');
  await accessible(page);
  await capture(page, info, 'pending-approvals');
  await page.getByRole('button', { name: /Review proposal/ }).click();
  await accessible(page);
  await capture(page, info, 'review-dialog');
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole('dialog');
  const rect = await dialog.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await dialog
    .getByRole('button', { name: 'Record decision', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole('button', { name: 'Record decision', exact: true }),
  ).toBeInViewport();
  await capture(page, info, 'mobile-review-dialog');
});
