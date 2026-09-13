import { readFile } from 'node:fs/promises';
import type { Database } from './index.js';
import { customers, invoices, payments, subscriptions } from './schema.js';

export async function seed(db: Database) {
  const fixture = JSON.parse(await readFile(new URL('../../../../fixtures/business/baseline.json', import.meta.url), 'utf8'));
  await db.transaction(async (tx) => {
    await tx.insert(customers).values(fixture.customers.map((row: typeof customers.$inferInsert) => ({
      ...row, createdAt: new Date(row.createdAt),
    }))).onConflictDoNothing();
    await tx.insert(subscriptions).values(fixture.subscriptions.map((row: typeof subscriptions.$inferInsert) => ({
      ...row, renewalDate: new Date(row.renewalDate),
    }))).onConflictDoNothing();
    await tx.insert(invoices).values(fixture.invoices).onConflictDoNothing();
    await tx.insert(payments).values(fixture.payments.map((row: typeof payments.$inferInsert) => ({
      ...row, createdAt: new Date(row.createdAt),
    }))).onConflictDoNothing();
  });
}
