import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createTicketSchema } from '../../../packages/contracts/src/tickets.js';
import type { Database } from './db/index.js';
import { auditEvents, automationRuns, customers, invoices, outboxEvents, payments, proposedActions, refunds, subscriptions, ticketMessages, tickets, waitExercises } from './db/schema.js';
import { createTicket } from './tickets.js';
import { claimEvent, classifyRun, evaluateTriagePolicy } from './triage.js';
import { claimAction, decideApproval, executeAction, executeSupportResponse, verifyAction, verifySupportResponse } from './actions.js';
import { FixtureProvider } from './providers.js';
import type { AIProvider } from './providers.js';
import { approveWaitExercise, completeWait, createWaitExercise, registerWait, resumeWait } from './waits.js';
import { approvalQueue, outcomeMetrics, publicDashboardPaths, registerDashboard, runEvidence, ticketDetail, ticketQueue } from './dashboard.js';
import { effortSchema, recordEffort } from './effort.js';

export function buildApp({ db, token, n8nToken, n8nOrigin, provider = new FixtureProvider(), now = () => new Date() }: { db: Database; token: string; n8nToken?: string; n8nOrigin?: string; provider?: AIProvider; now?: () => Date }) {
  if (token.length < 32) throw new Error('LAB_OPERATOR_TOKEN must contain at least 32 characters.');
  if (n8nToken !== undefined && (n8nToken.length < 32 || n8nToken === token)) throw new Error('N8N_WEBHOOK_TOKEN must contain at least 32 characters and differ from LAB_OPERATOR_TOKEN.');
  const app = Fastify({ bodyLimit: 16 * 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  const expectedN8n = n8nToken ? digest(`Bearer ${n8nToken}`) : null;
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz' || publicDashboardPaths.has(request.url.split('?')[0]!)) return;
    const supplied = digest(request.headers.authorization ?? '');
    const operator = timingSafeEqual(expected, supplied);
    const automation = expectedN8n && timingSafeEqual(expectedN8n, supplied);
    const n8nRoute = request.url.startsWith('/automation/') || request.url.startsWith('/integrations/');
    if (!operator && !(n8nRoute && automation)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && ['attempt_limit', 'current_approval_required', 'proposal_changed', 'idempotency_conflict', 'refund_revalidation_failed', 'action_not_executable', 'verification_not_ready'].includes(error.message)) return reply.code(409).send({ error: error.message });
    if (error instanceof Error && ['wait_expired', 'wait_not_ready', 'approval_required', 'resume_url_conflict', 'resume_retry_exhausted', 'resume_callback_failed', 'observation_conflict'].includes(error.message)) return reply.code(409).send({ error: error.message });
    if (error instanceof Error && error.message === 'invalid_resume_url') return reply.code(400).send({ error: error.message });
    const code = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: status === 500 ? 'internal_error' : 'invalid_request' });
  });
  app.get('/healthz', async () => ({ service: 'relaydesk', mode: provider.mode }));
  registerDashboard(app);
  app.get('/readyz', async () => { await db.execute(sql`SELECT 1`); return { ready: true }; });
  app.get<{ Querystring: { mode?: string } }>('/api/v1/metrics/outcomes', async (request, reply) => {
    const selected = z.enum(['fixture', 'live']).safeParse(request.query.mode ?? 'fixture');
    if (!selected.success) return reply.code(400).send({ error: 'invalid_request' });
    return outcomeMetrics(db, selected.data === 'live' ? 'LIVE AI MODE' : 'FIXTURE MODE', now());
  });
  app.post('/api/v1/tickets', { schema: { body: z.toJSONSchema(createTicketSchema, { target: 'draft-7' }) } }, async (request, reply) => {
    const input = createTicketSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(201).send(await createTicket(db, input.data, now(), provider.mode));
  });
  app.get('/api/v1/tickets', async () => ticketQueue(db));
  app.post<{ Params: { id: string } }>('/api/v1/tickets/:id/effort', async (request, reply) => {
    const input = effortSchema.safeParse(request.body);
    if (!z.uuid().safeParse(request.params.id).success || !input.success) return reply.code(400).send({ error: 'invalid_request' });
    return await recordEffort(db, request.params.id, input.data, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/api/v1/tickets/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await ticketDetail(db, request.params.id) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, request.params.id));
    if (!run) return reply.code(404).send({ error: 'not_found' });
    const evidence = await runEvidence(db, run.id);
    const recordedProvider = evidence.jobs.find((j) => j.task === 'triage')?.provider;
    return { ...run, ...evidence, mode: recordedProvider === 'codex' ? 'LIVE AI MODE' : recordedProvider === 'fixture' ? 'FIXTURE MODE' : run.mode,
      audit: await db.select().from(auditEvents).where(eq(auditEvents.runId, run.id)).orderBy(asc(auditEvents.createdAt)),
      events: await db.select().from(outboxEvents).where(eq(outboxEvents.runId, run.id)),
    };
  });
  app.post<{ Params: { id: string } }>('/automation/v1/events/:id/claim', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await claimEvent(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/runs/:id/decision', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await classifyRun(db, request.params.id, now(), provider) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/runs/:id/policy', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await evaluateTriagePolicy(db, request.params.id, now()) ?? reply.code(409).send({ error: 'decision_required' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/actions/:id/claim', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await claimAction(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/actions/:id/execute-support', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await executeSupportResponse(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/actions/:id/verify-support', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await verifySupportResponse(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/actions/:id/execute', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const result = await executeAction(db, request.params.id, now());
    if (!result) return reply.code(404).send({ error: 'not_found' });
    if ('simulateLostResponse' in result && result.simulateLostResponse) return reply.code(503).send({ error: 'injected_lost_response' });
    return result;
  });
  app.post<{ Params: { id: string } }>('/automation/v1/actions/:id/verify', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await verifyAction(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get('/api/v1/approvals', async () => approvalQueue(db));
  app.post<{ Body: unknown }>('/api/v1/wait-exercises', async (request, reply) => {
    const input = z.strictObject({ expiresInSeconds: z.number().int().min(1).max(3600).default(300) }).safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(201).send(await createWaitExercise(db, now(), input.data.expiresInSeconds));
  });
  app.get<{ Params: { id: string } }>('/api/v1/wait-exercises/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [exercise] = await db.select().from(waitExercises).where(eq(waitExercises.id, request.params.id));
    return exercise ? { ...exercise, resumeUrl: undefined } : reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/api/v1/wait-exercises/:id/approve', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await approveWaitExercise(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/api/v1/wait-exercises/:id/resume', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await resumeWait(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/automation/v1/waits/:id/register', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const input = z.strictObject({ resumeUrl: z.url() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    return await registerWait(db, request.params.id, input.data.resumeUrl, now(), n8nOrigin) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/waits/:id/complete', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await completeWait(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/approvals/:id/decision', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const input = z.strictObject({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      return await decideApproval(db, request.params.id, input.data.decision, input.data.reason, now()) ?? reply.code(404).send({ error: 'not_found' });
    } catch (error) {
      if (error instanceof Error && ['approval_conflict', 'approval_expired', 'proposal_changed'].includes(error.message)) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/scenarios/:id/start', async (request, reply) => {
    const fixture = z.enum(['fail-before-commit', 'commit-lost-response', 'false-success', 'verification-unavailable']).safeParse(request.params.id);
    const input = z.strictObject({ customerRef: createTicketSchema.shape.customerRef.default('CUSTOMER-001'), message: createTicketSchema.shape.message.default('I was charged twice this month.'), failAttempts: z.number().int().min(1).max(2).optional(), unavailableReads: z.number().int().min(1).max(5).optional() }).safeParse(request.body ?? {});
    if (!fixture.success || !input.success) return reply.code(400).send({ error: 'invalid_request' });
    if (provider.mode !== 'FIXTURE MODE') return reply.code(409).send({ error: 'fixture_mode_required' });
    const mode = fixture.data.replaceAll('-', '_');
    const created = await createTicket(db, { customerRef: input.data.customerRef, message: input.data.message }, now(), provider.mode,
      { fixtureId: fixture.data, config: { mode, failAttempts: input.data.failAttempts ?? 1, unavailableReads: input.data.unavailableReads ?? 1 } });
    return reply.code(201).send({ ...created, scenario: fixture.data });
  });
  app.post<{ Params: { id: string } }>('/api/v1/runs/:id/reconcile', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [action] = await db.select().from(proposedActions).where(eq(proposedActions.runId, request.params.id));
    if (!action) return reply.code(404).send({ error: 'not_found' });
    return await verifyAction(db, action.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id/actions', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return { actions: await db.select().from(proposedActions).where(eq(proposedActions.runId, request.params.id)) };
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/tickets/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, request.params.id));
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    return { ...ticket, messages: await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id)).orderBy(asc(ticketMessages.createdAt)) };
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/customers/:id', async (request, reply) => {
    const [customer] = await db.select().from(customers).where(eq(customers.id, request.params.id));
    return customer ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/customers/:id/payments', async (request, reply) => {
    const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, request.params.id));
    if (!customer) return reply.code(404).send({ error: 'not_found' });
    return { payments: await db.select().from(payments).where(eq(payments.customerId, customer.id)).orderBy(asc(payments.createdAt)) };
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/customers/:id/subscription', async (request, reply) => {
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.customerId, request.params.id));
    return subscription ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/invoices/:id', async (request, reply) => {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, request.params.id));
    return invoice ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/payments/:id', async (request, reply) => {
    const [payment] = await db.select().from(payments).where(eq(payments.id, request.params.id));
    return payment ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/integrations/v1/refunds/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [refund] = await db.select().from(refunds).where(eq(refunds.id, request.params.id));
    return refund ?? reply.code(404).send({ error: 'not_found' });
  });
  return app;
}
