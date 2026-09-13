import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { ticketCreatedEventSchema } from '../../../../packages/contracts/src/tickets.js';

export const customers = pgTable('customers', {
  id: text().primaryKey(), name: text().notNull(), email: text().notNull().unique(),
  accountPlan: text('account_plan').notNull(), accountStatus: text('account_status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const subscriptions = pgTable('subscriptions', {
  id: text().primaryKey(), customerId: text('customer_id').notNull().references(() => customers.id),
  plan: text().notNull(), status: text().notNull(),
  renewalDate: timestamp('renewal_date', { withTimezone: true }).notNull(),
});
export const invoices = pgTable('invoices', {
  id: text().primaryKey(), customerId: text('customer_id').notNull().references(() => customers.id),
  subscriptionId: text('subscription_id').notNull().references(() => subscriptions.id),
  billingPeriod: text('billing_period').notNull(), amountMinor: integer('amount_minor').notNull(),
  currency: text().notNull(),
});
export const payments = pgTable('payments', {
  id: text().primaryKey(), customerId: text('customer_id').notNull().references(() => customers.id),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  amountMinor: integer('amount_minor').notNull(), currency: text().notNull(), status: text().notNull(),
  refundedAmountMinor: integer('refunded_amount_minor').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const tickets = pgTable('tickets', {
  id: uuid().primaryKey(), customerId: text('customer_id').references(() => customers.id),
  customerRef: text('customer_ref').notNull(), message: text().notNull(),
  status: text().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const automationRuns = pgTable('automation_runs', {
  id: uuid().primaryKey(), ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  phase: text().notNull(), mode: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const outboxEvents = pgTable('outbox_events', {
  id: uuid().primaryKey(), runId: uuid('run_id').notNull().references(() => automationRuns.id),
  eventType: text('event_type').notNull(),
  payload: jsonb().$type<z.infer<typeof ticketCreatedEventSchema>>().notNull(),
  status: text().notNull(), attempts: integer().notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const auditEvents = pgTable('audit_events', {
  id: uuid().primaryKey(), runId: uuid('run_id').notNull().references(() => automationRuns.id),
  eventType: text('event_type').notNull(), actor: text().notNull(),
  evidence: jsonb().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
