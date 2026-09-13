import { z } from 'zod';

export const createTicketSchema = z.strictObject({
  customerRef: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  message: z.string().trim().min(1).max(8000),
});

export const ticketCreatedEventSchema = z.strictObject({
  eventId: z.uuid(),
  eventType: z.literal('ticket.created'),
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  runId: z.uuid(),
  ticketId: z.uuid(),
});

export type CreateTicket = z.infer<typeof createTicketSchema>;
