import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './db/index.js';
import { actionAttempts, approvals, auditEvents, automationRuns, operationReceipts, payments, proposedActions, refunds, scenarioInstances, ticketMessages, tickets } from './db/schema.js';

const canonicalJson = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));

export async function claimAction(db: Database, actionId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, actionId));
    if (!action) return null;
    if (action.status === 'ready' || action.status === 'approved') {
      await tx.update(proposedActions).set({ status: 'executing', updatedAt: now }).where(eq(proposedActions.id, actionId));
      await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'action.claimed', actor: 'n8n:action-verification-v1', evidence: { actionId, kind: action.kind }, createdAt: now });
    }
    return { actionId, runId: action.runId, kind: action.kind, status: action.status === 'ready' || action.status === 'approved' ? 'executing' : action.status };
  });
}

export async function decideApproval(db: Database, approvalId: string, decision: 'approved' | 'rejected', reason: string, now: Date) {
  return db.transaction(async (tx) => {
    const [approval] = await tx.select().from(approvals).where(eq(approvals.id, approvalId)).for('update');
    if (!approval) return null;
    if (approval.status !== 'pending') {
      if (approval.status === decision) return { approvalId, actionId: approval.actionId, status: approval.status, replayed: true };
      throw new Error('approval_conflict');
    }
    if (approval.expiresAt <= now) {
      await tx.update(approvals).set({ status: 'expired', decidedAt: now }).where(eq(approvals.id, approvalId));
      throw new Error('approval_expired');
    }
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, approval.actionId));
    if (!action) return null;
    const hash = createHash('sha256').update(canonicalJson(action.parameters)).digest('hex');
    if (hash !== approval.proposalHash) throw new Error('proposal_changed');
    await tx.update(approvals).set({ status: decision, reviewer: 'local-reviewer', decisionReason: reason, decidedAt: now }).where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending')));
    await tx.update(proposedActions).set({ status: decision === 'approved' ? 'approved' : 'rejected', businessOutcome: decision === 'approved' ? 'pending' : 'not_performed', updatedAt: now }).where(eq(proposedActions.id, action.id));
    if (decision === 'approved') {
      const eventId = randomUUID();
      await tx.execute(sql`INSERT INTO outbox_events(id, run_id, event_type, payload, status, attempts, created_at)
        VALUES (${eventId}, ${action.runId}, 'action.ready', ${JSON.stringify({ eventId, eventType: 'action.ready', schemaVersion: 1, occurredAt: now.toISOString(), runId: action.runId, actionId: action.id })}::jsonb, 'pending', 0, ${now})`);
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: `approval.${decision}`, actor: 'local-reviewer', evidence: { approvalId, actionId: action.id, proposalHash: hash, reason }, createdAt: now });
    return { approvalId, actionId: action.id, status: decision, replayed: false };
  });
}

export async function executeRefund(db: Database, actionId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, actionId));
    if (!action || action.kind !== 'refund') return null;
    const [approval] = await tx.select().from(approvals).where(eq(approvals.actionId, actionId));
    if (!approval || approval.status !== 'approved' || approval.expiresAt <= now) throw new Error('current_approval_required');
    const parameters = action.parameters as { customerId: string; paymentId: string; amountMinor: number; currency: string };
    const requestHash = createHash('sha256').update(canonicalJson(parameters)).digest('hex');
    const [receipt] = await tx.select().from(operationReceipts).where(and(eq(operationReceipts.operation, 'refund.create'), eq(operationReceipts.idempotencyKey, action.idempotencyKey)));
    if (receipt) {
      if (receipt.requestHash !== requestHash) throw new Error('idempotency_conflict');
      return { actionId, ...receipt.result, replayed: true };
    }
    await tx.execute(sql`SELECT id FROM payments WHERE id = ${parameters.paymentId} FOR UPDATE`);
    const [payment] = await tx.select().from(payments).where(eq(payments.id, parameters.paymentId));
    if (!payment || payment.customerId !== parameters.customerId || payment.amountMinor !== parameters.amountMinor || payment.currency !== parameters.currency || payment.status !== 'captured' || payment.refundedAmountMinor !== 0) throw new Error('refund_revalidation_failed');
    const refundId = randomUUID();
    await tx.insert(refunds).values({ id: refundId, paymentId: payment.id, actionId, customerId: payment.customerId, amountMinor: payment.amountMinor, currency: payment.currency, status: 'completed', createdAt: now });
    await tx.update(payments).set({ refundedAmountMinor: payment.amountMinor }).where(eq(payments.id, payment.id));
    const result = { refundId, paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, status: 'completed' };
    await tx.insert(operationReceipts).values({ operation: 'refund.create', idempotencyKey: action.idempotencyKey, requestHash, result, createdAt: now });
    await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'refund.committed', actor: 'mock-billing-api', evidence: { actionId, refundId, paymentId: payment.id }, createdAt: now });
    return { actionId, ...result, replayed: false };
  });
}

export async function verifyRefund(db: Database, actionId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, actionId));
    if (!action || action.kind !== 'refund') return null;
    const parameters = action.parameters as { customerId: string; paymentId: string; amountMinor: number; currency: string };
    const [refund] = await tx.select().from(refunds).where(eq(refunds.actionId, actionId));
    const [payment] = await tx.select().from(payments).where(eq(payments.id, parameters.paymentId));
    const verified = Boolean(refund && payment && refund.paymentId === parameters.paymentId && refund.customerId === parameters.customerId && refund.amountMinor === parameters.amountMinor && refund.currency === parameters.currency && refund.status === 'completed' && payment.refundedAmountMinor === parameters.amountMinor);
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, action.runId));
    if (!run) return null;
    const unresolved = Array.isArray((run.decision as { unresolvedIssues?: unknown } | null)?.unresolvedIssues) ? (run.decision as { unresolvedIssues: unknown[] }).unresolvedIssues : [];
    await tx.update(proposedActions).set({ status: verified ? 'verified' : 'failed', businessOutcome: verified ? 'verified' : 'failed', updatedAt: now }).where(eq(proposedActions.id, actionId));
    if (verified) {
      await tx.insert(ticketMessages).values({ id: randomUUID(), ticketId: run.ticketId, actionId, authorType: 'automation', text: `Your duplicate charge refund of USD ${(parameters.amountMinor / 100).toFixed(2)} has been completed.`, visibility: 'customer', createdAt: now }).onConflictDoNothing();
      await tx.update(tickets).set({ status: unresolved.length ? 'human_follow_up' : 'resolved' }).where(eq(tickets.id, run.ticketId));
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'refund.verified', actor: 'verification:billing-read', evidence: { actionId, verified, refundId: refund?.id ?? null }, createdAt: now });
    return { actionId, runId: action.runId, outcome: verified ? 'verified' : 'failed', ticketResolution: verified ? (unresolved.length ? 'partial' : 'resolved') : 'open' };
  });
}

export async function executeAction(db: Database, actionId: string, now: Date) {
  const [action] = await db.select().from(proposedActions).where(eq(proposedActions.id, actionId));
  if (!action) return null;
  const [scenario] = await db.select().from(scenarioInstances).where(eq(scenarioInstances.runId, action.runId));
  const previous = await db.select({ id: actionAttempts.id }).from(actionAttempts).where(eq(actionAttempts.actionId, actionId));
  const attempt = previous.length + 1;
  const mode = String(scenario?.config.mode ?? 'normal');
  if (mode === 'fail_before_commit' && attempt <= Number(scenario?.config.failAttempts ?? 1)) {
    await db.insert(actionAttempts).values({ id: randomUUID(), actionId, attempt, result: 'failed_before_commit', evidence: { mode }, createdAt: now });
    throw new Error('injected_failure_before_commit');
  }
  if (mode === 'false_success') {
    await db.insert(actionAttempts).values({ id: randomUUID(), actionId, attempt, result: 'success_without_mutation', evidence: { mode }, createdAt: now });
    return { actionId, status: 'completed', syntheticSuccessWithoutMutation: true };
  }
  const result = action.kind === 'refund' ? await executeRefund(db, actionId, now) : await executeSupportResponse(db, actionId, now);
  const lost = mode === 'commit_lost_response' && result && !result.replayed && attempt === 1;
  await db.insert(actionAttempts).values({ id: randomUUID(), actionId, attempt, result: lost ? 'committed_response_lost' : result?.replayed ? 'idempotent_replay' : 'committed', evidence: { mode }, createdAt: now });
  return result && lost ? { ...result, simulateLostResponse: true } : result;
}
export async function verifyAction(db: Database, actionId: string, now: Date) {
  const [action] = await db.select().from(proposedActions).where(eq(proposedActions.id, actionId));
  if (!action) return null;
  const [scenario] = await db.select().from(scenarioInstances).where(eq(scenarioInstances.runId, action.runId));
  if (scenario && scenario.config.mode === 'verification_unavailable') {
    const reads = Number(scenario.counters.verificationReads ?? 0) + 1;
    await db.update(scenarioInstances).set({ counters: { ...scenario.counters, verificationReads: reads } }).where(eq(scenarioInstances.id, scenario.id));
    if (reads <= Number(scenario.config.unavailableReads ?? 1)) {
      await db.update(proposedActions).set({ status: 'unknown', businessOutcome: 'unknown', updatedAt: now }).where(eq(proposedActions.id, actionId));
      await db.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'verification.unknown', actor: 'verification:billing-read', evidence: { actionId, reads }, createdAt: now });
      return { actionId, runId: action.runId, outcome: 'unknown', reconciliationRequired: true };
    }
  }
  return action.kind === 'refund' ? verifyRefund(db, actionId, now) : verifySupportResponse(db, actionId, now);
}

export async function executeSupportResponse(db: Database, actionId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, actionId));
    if (!action || action.kind !== 'support_response') return null;
    if (!['ready', 'executing', 'verified'].includes(action.status)) throw new Error('action_not_executable');
    const [receipt] = await tx.select().from(operationReceipts).where(and(eq(operationReceipts.operation, 'ticket.message.create'), eq(operationReceipts.idempotencyKey, action.idempotencyKey)));
    if (receipt) return { actionId, ...receipt.result, replayed: true };
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, action.runId));
    if (!run) return null;
    const text = String(action.parameters.text ?? '');
    const requestHash = createHash('sha256').update(JSON.stringify({ ticketId: run.ticketId, text })).digest('hex');
    const messageId = randomUUID();
    await tx.insert(ticketMessages).values({ id: messageId, ticketId: run.ticketId, actionId, authorType: 'automation', text, visibility: 'customer', createdAt: now });
    const result = { messageId, ticketId: run.ticketId, stored: true };
    await tx.insert(operationReceipts).values({ operation: 'ticket.message.create', idempotencyKey: action.idempotencyKey, requestHash, result, createdAt: now });
    await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'support_response.stored', actor: 'mock-ticket-api', evidence: { actionId, messageId }, createdAt: now });
    return { actionId, ...result, replayed: false };
  });
}

export async function verifySupportResponse(db: Database, actionId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, actionId));
    if (!action || action.kind !== 'support_response') return null;
    const [message] = await tx.select().from(ticketMessages).where(eq(ticketMessages.actionId, actionId));
    const expected = String(action.parameters.text ?? '');
    const verified = Boolean(message && message.text === expected && message.visibility === 'customer');
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, action.runId));
    if (!run) return null;
    const unresolved = Array.isArray((run.decision as { unresolvedIssues?: unknown } | null)?.unresolvedIssues) ? (run.decision as { unresolvedIssues: unknown[] }).unresolvedIssues : [];
    await tx.update(proposedActions).set({ status: verified ? 'verified' : 'failed', businessOutcome: verified ? 'verified' : 'failed', updatedAt: now }).where(eq(proposedActions.id, actionId));
    if (verified && unresolved.length === 0) await tx.update(tickets).set({ status: 'resolved' }).where(eq(tickets.id, run.ticketId));
    await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'support_response.verified', actor: 'verification:ticket-read', evidence: { actionId, verified, messageId: message?.id ?? null }, createdAt: now });
    return { actionId, runId: action.runId, outcome: verified ? 'verified' : 'failed', ticketResolution: verified && unresolved.length === 0 ? 'resolved' : 'partial' };
  });
}
