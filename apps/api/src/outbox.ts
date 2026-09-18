import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type { Database } from './db/index.js';
import { outboxEvents } from './db/schema.js';

export async function deliverPendingEvents(db: Database, webhookUrls: string | Record<string, string>, token: string, now = new Date()) {
  const events = await db.select().from(outboxEvents).where(and(eq(outboxEvents.status, 'pending'), or(isNull(outboxEvents.nextAttemptAt), lte(outboxEvents.nextAttemptAt, now)))).orderBy(asc(outboxEvents.createdAt)).limit(10);
  let delivered = 0;
  for (const event of events) {
    const attempt = event.attempts + 1;
    await db.update(outboxEvents).set({ attempts: attempt, lastError: null }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, 'pending')));
    try {
      const webhookUrl = typeof webhookUrls === 'string' ? webhookUrls : webhookUrls[event.eventType];
      if (!webhookUrl) throw new Error(`no_webhook_for_${event.eventType}`);
      const response = await fetch(webhookUrl, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(event.payload), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`webhook_http_${response.status}`);
      await db.update(outboxEvents).set({ status: 'delivered', deliveredAt: now, lastError: null }).where(eq(outboxEvents.id, event.id));
      delivered++;
    } catch (error) {
      const exhausted = attempt >= 5;
      await db.update(outboxEvents).set({ status: exhausted ? 'failed' : 'pending', lastError: error instanceof Error ? error.message.slice(0, 200) : 'delivery_failed', nextAttemptAt: exhausted ? null : new Date(now.getTime() + Math.min(30_000, 1000 * 2 ** (attempt - 1))) }).where(eq(outboxEvents.id, event.id));
    }
  }
  return { attempted: events.length, delivered };
}
