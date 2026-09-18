import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { triageDecisionSchema } from '../../../packages/contracts/src/triage.js';
import type { TriageDecision } from '../../../packages/contracts/src/triage.js';
import type { Database } from './db/index.js';
import { aiJobs, auditEvents, automationRuns, outboxEvents, proposedActions, tickets, workflowExecutions } from './db/schema.js';

function fixtureDecision(message: string, customerResolved: boolean): TriageDecision {
  const text = message.toLowerCase();
  if (!customerResolved) return triageDecisionSchema.parse({ schemaVersion: 1, category: 'unknown', intent: 'unknown', priority: 'normal', recommendedAction: 'escalate', needsHumanReview: true, ambiguity: 'missing_information', evidenceRefs: ['ticket.customerRef'], unresolvedIssues: ['customer_identity'], reason: 'The synthetic customer reference did not resolve.' });
  if (text.includes('charged twice') || text.includes('duplicate charge')) return triageDecisionSchema.parse({ schemaVersion: 1, category: 'billing', intent: 'duplicate_charge', priority: 'high', recommendedAction: 'investigate_refund', needsHumanReview: true, ambiguity: 'clear', evidenceRefs: ['ticket.message', 'customer.payments'], unresolvedIssues: text.includes('account') || text.includes('free') ? ['account_plan_mismatch'] : [], reason: 'The message reports a possible duplicate charge; deterministic billing policy must verify it.' });
  if (text.includes('download') && text.includes('invoice')) return triageDecisionSchema.parse({ schemaVersion: 1, category: 'billing', intent: 'invoice_download', priority: 'normal', recommendedAction: 'reply', needsHumanReview: false, ambiguity: 'clear', evidenceRefs: ['ticket.message', 'faq.invoice_download'], unresolvedIssues: [], reason: 'The request matches the supported invoice-download guidance.' });
  if (text.includes('charge') && (text.includes('wrong') || text.includes('sort it'))) return triageDecisionSchema.parse({ schemaVersion: 1, category: 'billing', intent: 'ambiguous_charge', priority: 'normal', recommendedAction: 'clarify', needsHumanReview: false, ambiguity: 'missing_information', evidenceRefs: ['ticket.message'], unresolvedIssues: ['charge_identity'], reason: 'The message does not identify a specific billing problem.' });
  if (text.includes('account') || text.includes('plan')) return triageDecisionSchema.parse({ schemaVersion: 1, category: 'account', intent: 'account_mismatch', priority: 'normal', recommendedAction: 'escalate', needsHumanReview: true, ambiguity: 'clear', evidenceRefs: ['ticket.message', 'customer.subscription'], unresolvedIssues: ['account_plan_mismatch'], reason: 'Automatic account repair is outside the supported action set.' });
  return triageDecisionSchema.parse({ schemaVersion: 1, category: 'general', intent: 'general_support', priority: 'normal', recommendedAction: 'escalate', needsHumanReview: true, ambiguity: 'missing_information', evidenceRefs: ['ticket.message'], unresolvedIssues: ['unsupported_request'], reason: 'No bounded automatic action matches this request.' });
}

export async function claimEvent(db: Database, eventId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    if (!event) return null;
    const inserted = await tx.insert(workflowExecutions).values({ id: randomUUID(), runId: event.runId, eventId, workflowRevision: 'triage-decision-v1', attempt: event.attempts || 1, technicalStatus: 'claimed', startedAt: now }).onConflictDoNothing().returning({ id: workflowExecutions.id });
    if (inserted.length) {
      await tx.update(automationRuns).set({ phase: 'triage', claimedAt: now }).where(and(eq(automationRuns.id, event.runId), isNull(automationRuns.claimedAt)));
      await tx.insert(auditEvents).values({ id: randomUUID(), runId: event.runId, eventType: 'workflow.claimed', actor: 'n8n:triage-decision-v1', evidence: { eventId, workflowRevision: 'triage-decision-v1' }, createdAt: now });
    }
    return { eventId, runId: event.runId, duplicate: inserted.length === 0 };
  });
}

export async function classifyFixture(db: Database, runId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
    if (!run) return null;
    if (run.decision) return { runId, decision: triageDecisionSchema.parse(run.decision), reused: true };
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, run.ticketId));
    if (!ticket) return null;
    const started = performance.now();
    const decision = fixtureDecision(ticket.message, Boolean(ticket.customerId));
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    await tx.insert(aiJobs).values({ id: randomUUID(), runId, task: 'triage', provider: 'fixture', model: 'relaydesk-fixture-v1', status: 'completed', result: decision, durationMs, createdAt: now, completedAt: now }).onConflictDoNothing();
    await tx.update(automationRuns).set({ decision }).where(eq(automationRuns.id, runId));
    await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'triage.decision_recorded', actor: 'FixtureProvider', evidence: { provider: 'fixture', model: 'relaydesk-fixture-v1', durationMs, category: decision.category, intent: decision.intent }, createdAt: now });
    return { runId, decision, reused: false };
  });
}

export async function evaluateTriagePolicy(db: Database, runId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
    if (!run?.decision) return null;
    if (run.policyResult) return { runId, policy: run.policyResult, reused: true };
    const decision = triageDecisionSchema.parse(run.decision);
    const route = decision.recommendedAction === 'reply' && !decision.needsHumanReview ? 'automatic_support'
      : decision.recommendedAction === 'investigate_refund' ? 'approval_required'
      : decision.recommendedAction === 'clarify' ? 'clarification'
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
    return { runId, policy, reused: false };
  });
}
