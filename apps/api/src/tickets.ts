import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTicketSchema, ticketCreatedEventSchema } from '../../../packages/contracts/src/tickets.js';
import type { CreateTicket } from '../../../packages/contracts/src/tickets.js';
import type { Database } from './db/index.js';
import { auditEvents, automationRuns, customers, outboxEvents, scenarioInstances, tickets } from './db/schema.js';

export async function createTicket(db: Database, input: CreateTicket, now = new Date(), mode: 'FIXTURE MODE' | 'LIVE AI MODE' = 'FIXTURE MODE', scenario?: { fixtureId: string; config: Record<string, unknown> }) {
  const data = createTicketSchema.parse(input);
  return db.transaction(async (tx) => {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, data.customerRef));
    const ticketId = randomUUID();
    const runId = randomUUID();
    const eventId = randomUUID();
    const event = ticketCreatedEventSchema.parse({
      eventId, eventType: 'ticket.created', schemaVersion: 1,
      occurredAt: now.toISOString(), runId, ticketId,
    });
    await tx.insert(tickets).values({ id: ticketId, customerId: customer?.id ?? null,
      customerRef: data.customerRef, message: data.message, status: 'open', createdAt: now });
    await tx.insert(automationRuns).values({ id: runId, ticketId, phase: 'pending', mode, createdAt: now });
    if (scenario) await tx.insert(scenarioInstances).values({ id: randomUUID(), runId, fixtureId: scenario.fixtureId, config: scenario.config, counters: {}, createdAt: now });
    await tx.insert(auditEvents).values({ id: randomUUID(), runId, eventType: 'ticket.received',
      actor: 'local-operator', evidence: { ticketId, customerResolved: Boolean(customer) }, createdAt: now });
    await tx.insert(outboxEvents).values({ id: eventId, runId, eventType: event.eventType,
      payload: event, status: 'pending', createdAt: now });
    return { ticketId, runId, eventId, phase: 'pending', mode };
  });
}
