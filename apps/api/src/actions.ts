import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from './db/index.js';
import { auditEvents, automationRuns, operationReceipts, proposedActions, ticketMessages, tickets } from './db/schema.js';

export async function claimAction(db: Database, actionId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(proposedActions).where(eq(proposedActions.id, actionId));
    if (!action) return null;
    if (action.status === 'ready') {
      await tx.update(proposedActions).set({ status: 'executing', updatedAt: now }).where(and(eq(proposedActions.id, actionId), eq(proposedActions.status, 'ready')));
      await tx.insert(auditEvents).values({ id: randomUUID(), runId: action.runId, eventType: 'action.claimed', actor: 'n8n:action-verification-v1', evidence: { actionId, kind: action.kind }, createdAt: now });
    }
    return { actionId, runId: action.runId, kind: action.kind, status: action.status === 'ready' ? 'executing' : action.status };
  });
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
