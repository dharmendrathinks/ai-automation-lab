import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createTicketSchema } from '../../../packages/contracts/src/tickets.js';
import type { Database } from './db/index.js';
import { auditEvents, automationRuns, customers, invoices, outboxEvents, payments, subscriptions, tickets } from './db/schema.js';
import { createTicket } from './tickets.js';
import { claimEvent, classifyFixture, evaluateTriagePolicy } from './triage.js';

export function buildApp({ db, token, n8nToken, now = () => new Date() }: { db: Database; token: string; n8nToken?: string; now?: () => Date }) {
  if (token.length < 32) throw new Error('LAB_OPERATOR_TOKEN must contain at least 32 characters.');
  const app = Fastify({ bodyLimit: 16 * 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  const expectedN8n = n8nToken ? digest(`Bearer ${n8nToken}`) : null;
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return;
    const supplied = digest(request.headers.authorization ?? '');
    const operator = timingSafeEqual(expected, supplied);
    const automation = expectedN8n && timingSafeEqual(expectedN8n, supplied);
    const n8nRoute = request.url.startsWith('/automation/') || request.url.startsWith('/integrations/');
    if (!operator && !(n8nRoute && automation)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: status === 500 ? 'internal_error' : 'invalid_request' });
  });
  app.get('/healthz', async () => ({ service: 'relaydesk', mode: 'FIXTURE MODE' }));
  app.get('/readyz', async () => { await db.execute(sql`SELECT 1`); return { ready: true }; });
  app.post('/api/v1/tickets', { schema: { body: z.toJSONSchema(createTicketSchema, { target: 'draft-7' }) } }, async (request, reply) => {
    const input = createTicketSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(201).send(await createTicket(db, input.data, now()));
  });
  app.get('/api/v1/tickets', async () => ({ tickets: await db.select().from(tickets).orderBy(desc(tickets.createdAt)).limit(100) }));
  app.get<{ Params: { id: string } }>('/api/v1/tickets/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, request.params.id));
    return ticket ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, request.params.id));
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return { ...run,
      audit: await db.select().from(auditEvents).where(eq(auditEvents.runId, run.id)).orderBy(asc(auditEvents.createdAt)),
      events: await db.select().from(outboxEvents).where(eq(outboxEvents.runId, run.id)),
    };
  });
  app.post<{ Params: { id: string } }>('/automation/v1/events/:id/claim', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await claimEvent(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/runs/:id/fixture-decision', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await classifyFixture(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/runs/:id/policy', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await evaluateTriagePolicy(db, request.params.id, now()) ?? reply.code(409).send({ error: 'decision_required' });
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
  return app;
}
