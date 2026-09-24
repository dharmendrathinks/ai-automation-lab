import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './db/index.js';
import { waitExercises } from './db/schema.js';

export async function createWaitExercise(
  db: Database,
  now: Date,
  expiresInSeconds = 300,
) {
  const exercise = {
    id: randomUUID(),
    status: 'pending',
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
    createdAt: now,
  };
  await db.insert(waitExercises).values(exercise);
  return exercise;
}

// Commit expiry before reporting conflict: throwing in a transaction rolls it back.
async function transition<T>(
  db: Database,
  id: string,
  now: Date,
  change: (
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    row: typeof waitExercises.$inferSelect,
  ) => Promise<T>,
) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM wait_exercises WHERE id=${id} FOR UPDATE`,
    );
    const [row] = await tx
      .select()
      .from(waitExercises)
      .where(eq(waitExercises.id, id));
    if (!row) return null;
    if (
      row.status !== 'completed' &&
      (row.status === 'expired' || row.expiresAt <= now)
    ) {
      await tx
        .update(waitExercises)
        .set({ status: 'expired' })
        .where(eq(waitExercises.id, id));
      return { expired: true } as const;
    }
    return { value: await change(tx, row) };
  });
  if (result && 'expired' in result) throw new Error('wait_expired');
  return result?.value ?? null;
}

export function approveWaitExercise(db: Database, id: string, now: Date) {
  return transition(db, id, now, async (tx, row) => {
    if (row.status !== 'pending')
      return { exerciseId: id, status: row.status, replayed: true };
    await tx
      .update(waitExercises)
      .set({ status: 'approved', approvedAt: now })
      .where(eq(waitExercises.id, id));
    return {
      exerciseId: id,
      status: 'approved',
      approvedAt: now,
      replayed: false,
    };
  });
}

export async function registerWait(
  db: Database,
  id: string,
  resumeUrl: string,
  now: Date,
  configuredOrigin?: string,
) {
  const parsed = new URL(resumeUrl);
  // Pinned n8n signs resume URLs. Permit only its single opaque signature,
  // never arbitrary query parameters or credentials.
  const validQuery =
    !parsed.search || /^\?signature=[a-f0-9]{64}$/.test(parsed.search);
  const allowedOrigin = configuredOrigin
    ? parsed.origin === configuredOrigin
    : ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
      parsed.port === '5678';
  if (
    parsed.protocol !== 'http:' ||
    parsed.username ||
    parsed.password ||
    !validQuery ||
    parsed.hash ||
    !allowedOrigin ||
    !/^\/webhook-waiting\/[A-Za-z0-9/_-]+$/.test(parsed.pathname)
  )
    throw new Error('invalid_resume_url');
  return transition(db, id, now, async (tx, row) => {
    if (row.resumeUrl && row.resumeUrl !== resumeUrl)
      throw new Error('resume_url_conflict');
    if (!row.resumeUrl)
      await tx
        .update(waitExercises)
        .set({ resumeUrl })
        .where(eq(waitExercises.id, id));
    return {
      exerciseId: id,
      status: row.status,
      approvalRecorded: ['approved', 'callback_sent', 'completed'].includes(
        row.status,
      ),
    };
  });
}

export async function resumeWait(db: Database, id: string, now: Date) {
  const claimed = await transition(db, id, now, async (tx, row) => {
    if (row.status === 'completed')
      return { completed: true, replayed: true } as const;
    if (!['approved', 'callback_sent'].includes(row.status))
      throw new Error('approval_required');
    if (!row.resumeUrl) throw new Error('wait_not_ready');
    if (row.callbackAttempts >= 5) throw new Error('resume_retry_exhausted');
    await tx
      .update(waitExercises)
      .set({ callbackAttempts: row.callbackAttempts + 1 })
      .where(eq(waitExercises.id, id));
    return {
      completed: false,
      resumeUrl: row.resumeUrl,
      attempt: row.callbackAttempts + 1,
    } as const;
  });
  if (!claimed || claimed.completed) return claimed;
  let accepted = false;
  try {
    const response = await fetch(claimed.resumeUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exerciseId: id }),
    });
    accepted = response.ok;
    await response.body?.cancel();
  } catch {
    /* A lost response does not prove the destination failed. */
  }
  const [latest] = await db
    .select()
    .from(waitExercises)
    .where(eq(waitExercises.id, id));
  if (latest?.status === 'completed')
    return { completed: true, replayed: true };
  if (!accepted) throw new Error('resume_callback_failed');
  // Completion/expiry can race the HTTP response. Never regress terminal state.
  await db
    .update(waitExercises)
    .set({ status: 'callback_sent' })
    .where(and(eq(waitExercises.id, id), eq(waitExercises.status, 'approved')));
  return { completed: false, callbackAccepted: true, attempt: claimed.attempt };
}

export function completeWait(db: Database, id: string, now: Date) {
  return transition(db, id, now, async (tx, row) => {
    if (row.status === 'completed')
      return { exerciseId: id, status: 'completed', replayed: true };
    if (!row.approvedAt || !['approved', 'callback_sent'].includes(row.status))
      throw new Error('approval_required');
    await tx
      .update(waitExercises)
      .set({ status: 'completed', completedAt: now })
      .where(eq(waitExercises.id, id));
    return { exerciseId: id, status: 'completed', replayed: false };
  });
}
