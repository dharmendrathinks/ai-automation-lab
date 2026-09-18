import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { triageDecisionSchema } from '../../../packages/contracts/src/triage.js';
import type { Database } from './db/index.js';
import { aiJobs, approvals, auditEvents, automationRuns, outboxEvents, payments, proposedActions, tickets, workflowExecutions } from './db/schema.js';
import type { AIProvider } from './providers.js';

const canonicalJson = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));

export async function claimEvent(db: Database, eventId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    if (!event || event.eventType !== 'ticket.created') return null;
    const inserted = await tx.insert(workflowExecutions).values({ id: randomUUID(), runId: event.runId, eventId, workflowRevision: 'triage-decision-v1', attempt: event.attempts || 1, technicalStatus: 'claimed', startedAt: now }).onConflictDoNothing().returning({ id: workflowExecutions.id });
    if (inserted.length) {
      await tx.update(automationRuns).set({ phase: 'triage', claimedAt: now }).where(and(eq(automationRuns.id, event.runId), isNull(automationRuns.claimedAt)));
      await tx.insert(auditEvents).values({ id: randomUUID(), runId: event.runId, eventType: 'workflow.claimed', actor: 'n8n:triage-decision-v1', evidence: { eventId, workflowRevision: 'triage-decision-v1' }, createdAt: now });
    } else {
      await tx.insert(auditEvents).values({ id: randomUUID(), runId: event.runId, eventType: 'duplicate.event_suppressed', actor: 'backend:event-claim', evidence: { eventId }, createdAt: now });
    }
    return { eventId, runId: event.runId, duplicate: inserted.length === 0 };
  });
}

export async function classifyRun(db: Database, runId: string, now: Date, provider: AIProvider) {
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run) return null;
  if (run.decision) return { runId, decision: triageDecisionSchema.parse(run.decision), reused: true };
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, run.ticketId));
  if (!ticket) return null;
  const customerPayments = ticket.customerId ? await db.select({ id: payments.id, invoiceId: payments.invoiceId, amountMinor: payments.amountMinor, currency: payments.currency, status: payments.status }).from(payments).where(eq(payments.customerId, ticket.customerId)) : [];
  const started = performance.now();
  try {
    const result = await provider.classify({ ticket: { id: ticket.id, message: ticket.message, customerRef: ticket.customerRef }, customerResolved: Boolean(ticket.customerId), payments: customerPayments });
    return await db.transaction(async (tx) => {
      const inserted = await tx.insert(aiJobs).values({ id: randomUUID(), runId, task: 'triage', provider: result.provider, model: result.model, status: 'completed', result: { decision: result.decision, usage: result.usage }, durationMs: result.durationMs, createdAt: now, completedAt: now }).onConflictDoNothing().returning({ id: aiJobs.id });
      if (!inserted.length) {
        const [existing] = await tx.select({ decision: automationRuns.decision }).from(automationRuns).where(eq(automationRuns.id, runId));
        if (!existing?.decision) throw new Error('provider_result_conflict');
        return { runId, decision: triageDecisionSchema.parse(existing.decision), reused: true };
      }
      await tx.update(automationRuns).set({ decision: result.decision }).where(eq(automationRuns.id, runId));
      await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'triage.decision_recorded', actor: result.provider === 'codex' ? 'CodexProvider' : 'FixtureProvider', evidence: { provider: result.provider, model: result.model, durationMs: result.durationMs, usage: result.usage, category: result.decision.category, intent: result.decision.intent }, createdAt: now });
      return { runId, decision: result.decision, reused: false };
    });
  } catch (error) {
    const code = error instanceof Error && ['authentication_required', 'provider_unavailable', 'provider_timeout', 'provider_output_limit', 'security_violation', 'invalid_output'].includes(error.message) ? error.message : 'provider_unavailable';
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(aiJobs).values({ id: randomUUID(), runId, task: 'triage', provider: provider.provider, model: provider.model, status: 'failed', errorCode: code, durationMs, createdAt: now, completedAt: now }).onConflictDoNothing().returning({ id: aiJobs.id });
      if (inserted.length) await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'triage.provider_failed', actor: provider.provider === 'codex' ? 'CodexProvider' : 'FixtureProvider', evidence: { provider: provider.provider, model: provider.model, durationMs, errorCode: code }, createdAt: now });
    });
    throw error;
  }
}

export async function evaluateTriagePolicy(db: Database, runId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
    if (!run?.decision) return null;
    if (run.policyResult) return { runId, policy: run.policyResult, reused: true };
    const decision = triageDecisionSchema.parse(run.decision);
    const route = decision.intent === 'invoice_download' && decision.recommendedAction === 'reply' && !decision.needsHumanReview ? 'automatic_support'
      : decision.intent === 'duplicate_charge' && decision.recommendedAction === 'investigate_refund' ? 'approval_required'
      : decision.intent === 'ambiguous_charge' && decision.recommendedAction === 'clarify' ? 'clarification'
      : 'human_follow_up';
    const policy = { version: 'triage-policy-v1', route, allowed: route === 'automatic_support', escalationReason: route === 'human_follow_up' ? decision.unresolvedIssues[0] ?? 'unsupported_request' : null };
    const ticketStatus = route === 'clarification' ? 'awaiting_customer' : route === 'human_follow_up' ? 'human_follow_up' : 'open';
    await tx.update(automationRuns).set({ policyResult: policy, outcome: route, escalationReason: policy.escalationReason, phase: 'completed', completedAt: now }).where(eq(automationRuns.id, runId));
    await tx.update(tickets).set({ status: ticketStatus }).where(eq(tickets.id, run.ticketId));
    await tx.update(workflowExecutions).set({ technicalStatus: 'completed', completedAt: now }).where(eq(workflowExecutions.runId, runId));
    await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'triage.policy_recorded', actor: 'backend:triage-policy-v1', evidence: policy, createdAt: now });
    if (route === 'automatic_support') {
      const actionId = randomUUID();
      const eventId = randomUUID();
      const text = 'You can download invoices from Settings → Billing → Invoices.';
      const inserted = await tx.insert(proposedActions).values({ id: actionId, runId, kind: 'support_response', parameters: { text }, policyVersion: 'triage-policy-v1', status: 'ready', idempotencyKey: `action:${actionId}:support-response:v1`, businessOutcome: 'pending', createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: proposedActions.id });
      if (inserted.length) {
        await tx.insert(outboxEvents).values({ id: eventId, runId, eventType: 'action.ready', payload: { eventId, eventType: 'action.ready', schemaVersion: 1, occurredAt: now.toISOString(), runId, actionId }, status: 'pending', createdAt: now });
        await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'action.proposed', actor: 'backend:triage-policy-v1', evidence: { actionId, kind: 'support_response', status: 'ready' }, createdAt: now });
      }
    }
    if (route === 'approval_required') {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, run.ticketId));
      const candidates = ticket?.customerId ? await tx.select().from(payments).where(and(eq(payments.customerId, ticket.customerId), eq(payments.status, 'captured'))).orderBy(asc(payments.createdAt), asc(payments.id)) : [];
      const eligible = candidates.filter((candidate, index) => candidates.some((other, otherIndex) => otherIndex < index && other.invoiceId === candidate.invoiceId && other.amountMinor === candidate.amountMinor && other.currency === candidate.currency)).at(-1);
      const withinAge = eligible ? now.getTime() - eligible.createdAt.getTime() <= 30 * 24 * 60 * 60 * 1000 : false;
      if (ticket?.customerId && eligible && withinAge && eligible.amountMinor <= 10_000 && eligible.refundedAmountMinor === 0) {
        const actionId = randomUUID();
        const parameters = { customerId: ticket.customerId, paymentId: eligible.id, invoiceId: eligible.invoiceId, amountMinor: eligible.amountMinor, currency: eligible.currency };
        const proposalHash = createHash('sha256').update(canonicalJson(parameters)).digest('hex');
        const inserted = await tx.insert(proposedActions).values({ id: actionId, runId, kind: 'refund', parameters, policyVersion: 'refund-policy-v1', status: 'pending_approval', idempotencyKey: `action:${actionId}:refund:v1`, businessOutcome: 'pending', createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: proposedActions.id });
        if (inserted.length) {
          await tx.insert(approvals).values({ id: randomUUID(), actionId, proposalHash, status: 'pending', requestedAt: now, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
          await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'refund.proposed', actor: 'backend:refund-policy-v1', evidence: { actionId, proposalHash, paymentId: eligible.id, amountMinor: eligible.amountMinor, currency: eligible.currency }, createdAt: now });
        }
      }
    }
    return { runId, policy, reused: false };
  });
}
