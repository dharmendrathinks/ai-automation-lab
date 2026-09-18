import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createTicketSchema } from '../../../packages/contracts/src/tickets.js';
import type { Database } from './db/index.js';
import { approvals, auditEvents, automationRuns, customers, invoices, outboxEvents, payments, proposedActions, refunds, scenarioInstances, subscriptions, ticketMessages, tickets, waitExercises } from './db/schema.js';
import { createTicket } from './tickets.js';
import { claimEvent, classifyRun, evaluateTriagePolicy } from './triage.js';
import { claimAction, decideApproval, executeAction, executeSupportResponse, verifyAction, verifySupportResponse } from './actions.js';
import { FixtureProvider } from './providers.js';
import type { AIProvider } from './providers.js';
import { approveWaitExercise, completeWait, createWaitExercise, registerWait, resumeWait } from './waits.js';

export function buildApp({ db, token, n8nToken, provider = new FixtureProvider(), now = () => new Date() }: { db: Database; token: string; n8nToken?: string; provider?: AIProvider; now?: () => Date }) {
  if (token.length < 32) throw new Error('LAB_OPERATOR_TOKEN must contain at least 32 characters.');
  const app = Fastify({ bodyLimit: 16 * 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  const expectedN8n = n8nToken ? digest(`Bearer ${n8nToken}`) : null;
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz' || request.url === '/dashboard') return;
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
  app.get('/healthz', async () => ({ service: 'relaydesk', mode: provider.mode }));
  app.get('/dashboard', async (_request, reply) => reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RelayDesk evidence dashboard</title>
<style>:root{color-scheme:light}body{font:16px system-ui;max-width:1000px;margin:3rem auto;padding:0 1rem;color:#18202a;background:#f7f8fa}header,.panel{background:white;border:1px solid #dfe3e8;border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 2px 8px #16202a0a}h1,h2{margin-top:0}.mode{display:inline-block;font-weight:750;color:#7a3e00;background:#fff1df;border-radius:99px;padding:.35rem .7rem}form{display:grid;grid-template-columns:1fr 1fr auto;gap:.75rem;align-items:end}label{display:grid;gap:.35rem;font-weight:600}input,button{font:inherit;padding:.7rem;border:1px solid #aeb7c2;border-radius:7px}button{background:#173f67;color:white;border:0;font-weight:700;cursor:pointer}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem}.card{background:#f1f5f8;border-radius:8px;padding:.8rem}.card span{display:block;color:#5e6975;font-size:.85rem}.card strong{font-size:1.35rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101820;color:#e7edf3;padding:1rem;border-radius:8px;min-height:5rem}@media(max-width:700px){form{grid-template-columns:1fr}}</style>
<header><h1>RelayDesk evidence dashboard</h1><span class="mode">${provider.mode}</span><p>Inspect verified outcomes and the durable audit timeline. Rates describe the current synthetic cohort, not customer satisfaction.</p></header>
<section class="panel"><form id="form"><label>Run ID<input id="run" required></label><label>Local operator token<input id="token" type="password" required></label><button>Load evidence</button></form></section>
<section class="panel"><h2>Outcome metrics</h2><div class="cards" id="metrics"><div class="card"><span>Status</span><strong>Enter token</strong></div></div></section>
<section class="panel"><h2>Run timeline</h2><pre id="output">Enter a synthetic run ID.</pre></section>
<script>const pct=v=>v==null?'N/A':Math.round(v*100)+'%';document.querySelector('#form').addEventListener('submit',async(e)=>{e.preventDefault();const out=document.querySelector('#output'),cards=document.querySelector('#metrics'),id=document.querySelector('#run').value,token=document.querySelector('#token').value,headers={authorization:'Bearer '+token};out.textContent='Loading…';cards.textContent='Loading…';const [run,metrics]=await Promise.all([fetch('/api/v1/runs/'+encodeURIComponent(id),{headers}),fetch('/api/v1/metrics/outcomes',{headers})]);const r=await run.json(),m=await metrics.json();out.textContent=JSON.stringify(r,null,2);cards.innerHTML=[['Automation',pct(m.automationRate)],['Verified completion',pct(m.verifiedCompletionRate)],['Human escalation',pct(m.humanEscalationRate)],['Duplicate prevention',m.reliability?.duplicatePreventionEvents??'N/A']].map(x=>'<div class="card"><span>'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join('')});</script></html>`));
  app.get('/readyz', async () => { await db.execute(sql`SELECT 1`); return { ready: true }; });
  app.get('/api/v1/metrics/outcomes', async () => {
    const result = await db.execute(sql`SELECT
      count(*)::int AS tickets,
      count(*) FILTER (WHERE t.status = 'resolved')::int AS resolved,
      count(*) FILTER (WHERE t.status = 'human_follow_up')::int AS escalated,
      count(*) FILTER (WHERE a.business_outcome = 'verified')::int AS verified_actions,
      avg(EXTRACT(EPOCH FROM (a.updated_at - t.created_at)) * 1000) FILTER (WHERE a.business_outcome = 'verified') AS mean_handling_ms,
      (SELECT avg(EXTRACT(EPOCH FROM (decided_at - requested_at)) * 1000) FROM approvals WHERE decided_at IS NOT NULL) AS mean_approval_elapsed_ms
      FROM tickets t
      LEFT JOIN automation_runs r ON r.ticket_id = t.id
      LEFT JOIN proposed_actions a ON a.run_id = r.id`);
    const row = result.rows[0] as { tickets: number; resolved: number; escalated: number; verified_actions: number; mean_handling_ms: string | null; mean_approval_elapsed_ms: string | null };
    const reliability = await db.execute(sql`SELECT
      (SELECT count(*)::int FROM proposed_actions) AS attempted_actions,
      (SELECT count(*)::int FROM proposed_actions WHERE business_outcome='failed') AS failed_actions,
      (SELECT count(*)::int FROM (SELECT action_id FROM action_attempts GROUP BY action_id HAVING count(*) > 1) retried) AS retried_actions,
      (SELECT count(DISTINCT run_id)::int FROM audit_events WHERE event_type='verification.unknown') AS ever_unknown,
      (SELECT count(DISTINCT a.id)::int FROM proposed_actions a WHERE a.business_outcome='verified' AND EXISTS (SELECT 1 FROM audit_events e WHERE e.run_id=a.run_id AND e.event_type='verification.unknown')) AS recovered_actions,
      (SELECT count(*)::int FROM proposed_actions WHERE business_outcome='unknown') AS current_unknown,
      (SELECT count(*)::int FROM audit_events WHERE event_type='duplicate.event_suppressed') + (SELECT count(*)::int FROM action_attempts WHERE result='idempotent_replay') AS duplicate_prevention_events`);
    const rel = reliability.rows[0] as Record<string, number | null>;
    return { mode: provider.mode, cohort: { tickets: row.tickets }, automationRate: row.tickets ? row.resolved / row.tickets : null, humanEscalationRate: row.tickets ? row.escalated / row.tickets : null, verifiedCompletionRate: row.tickets ? row.resolved / row.tickets : null, verifiedActions: row.verified_actions, meanHandlingMs: row.mean_handling_ms === null ? null : Number(row.mean_handling_ms), meanApprovalElapsedMs: row.mean_approval_elapsed_ms === null ? null : Number(row.mean_approval_elapsed_ms), activeReviewMinutes: null, humanMinutesPerTicket: null, estimatedHumanMinutesSaved: null, reliability: { attemptedActions: rel.attempted_actions ?? 0, failureRate: rel.attempted_actions ? Number(rel.failed_actions ?? 0) / rel.attempted_actions : null, retriedActions: rel.retried_actions ?? 0, everUnknown: rel.ever_unknown ?? 0, currentUnknown: rel.current_unknown ?? 0, recoveredActions: rel.recovered_actions ?? 0, duplicatePreventionEvents: rel.duplicate_prevention_events ?? 0 } };
  });
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
  app.get('/api/v1/approvals', async () => ({ approvals: await db.select().from(approvals).orderBy(desc(approvals.requestedAt)) }));
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
    return await registerWait(db, request.params.id, input.data.resumeUrl, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string } }>('/automation/v1/waits/:id/complete', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    return await completeWait(db, request.params.id, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/approvals/:id/decision', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'invalid_request' });
    const input = z.strictObject({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    return await decideApproval(db, request.params.id, input.data.decision, input.data.reason, now()) ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/scenarios/:id/start', async (request, reply) => {
    const fixture = z.enum(['fail-before-commit', 'commit-lost-response', 'false-success', 'verification-unavailable']).safeParse(request.params.id);
    const input = z.strictObject({ customerRef: z.string().default('CUSTOMER-001'), message: z.string().default('I was charged twice this month.'), failAttempts: z.number().int().min(1).max(2).optional(), unavailableReads: z.number().int().min(1).max(5).optional() }).safeParse(request.body ?? {});
    if (!fixture.success || !input.success) return reply.code(400).send({ error: 'invalid_request' });
    const created = await createTicket(db, { customerRef: input.data.customerRef, message: input.data.message }, now());
    const mode = fixture.data.replaceAll('-', '_');
    await db.insert(scenarioInstances).values({ id: randomUUID(), runId: created.runId, fixtureId: fixture.data, config: { mode, failAttempts: input.data.failAttempts ?? 1, unavailableReads: input.data.unavailableReads ?? 1 }, counters: {}, createdAt: now() });
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
