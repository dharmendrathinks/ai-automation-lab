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
  decision: jsonb(), policyResult: jsonb('policy_result'), outcome: text(),
  escalationReason: text('escalation_reason'), claimedAt: timestamp('claimed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const outboxEvents = pgTable('outbox_events', {
  id: uuid().primaryKey(), runId: uuid('run_id').notNull().references(() => automationRuns.id),
  eventType: text('event_type').notNull(),
  payload: jsonb().$type<z.infer<typeof ticketCreatedEventSchema>>().notNull(),
  status: text().notNull(), attempts: integer().notNull().default(0),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }), lastError: text('last_error'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const aiJobs = pgTable('ai_jobs', {
  id: uuid().primaryKey(), runId: uuid('run_id').notNull().references(() => automationRuns.id),
  task: text().notNull(), provider: text().notNull(), model: text().notNull(), status: text().notNull(),
  result: jsonb(), errorCode: text('error_code'), durationMs: integer('duration_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
});
export const workflowExecutions = pgTable('workflow_executions', {
  id: uuid().primaryKey(), runId: uuid('run_id').notNull().references(() => automationRuns.id),
  eventId: uuid('event_id').notNull().references(() => outboxEvents.id), workflowRevision: text('workflow_revision').notNull(),
  attempt: integer().notNull(), technicalStatus: text('technical_status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(), completedAt: timestamp('completed_at', { withTimezone: true }),
});
export const auditEvents = pgTable('audit_events', {
  id: uuid().primaryKey(), runId: uuid('run_id').notNull().references(() => automationRuns.id),
  eventType: text('event_type').notNull(), actor: text().notNull(),
  evidence: jsonb().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
