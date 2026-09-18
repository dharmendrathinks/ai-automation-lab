import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Database } from './db/index.js';
import { waitExercises } from './db/schema.js';

export async function createWaitExercise(db: Database, now: Date, expiresInSeconds = 300) {
  const exercise = { id: randomUUID(), status: 'pending', expiresAt: new Date(now.getTime() + expiresInSeconds * 1000), createdAt: now };
  await db.insert(waitExercises).values(exercise);
  return exercise;
}

export async function approveWaitExercise(db: Database, id: string, now: Date) {
  const [current] = await db.select().from(waitExercises).where(eq(waitExercises.id, id));
  if (!current) return null;
  if (current.status === 'expired' || (current.expiresAt <= now && current.status !== 'completed')) {
    await db.update(waitExercises).set({ status: 'expired' }).where(eq(waitExercises.id, id));
    throw new Error('wait_expired');
  }
  return db.transaction(async (tx) => {
    const [exercise] = await tx.select().from(waitExercises).where(eq(waitExercises.id, id));
    if (!exercise) return null;
    if (['approved', 'callback_sent', 'completed'].includes(exercise.status)) return { ...exercise, replayed: true };
    await tx.update(waitExercises).set({ status: 'approved', approvedAt: now }).where(eq(waitExercises.id, id));
    return { ...exercise, status: 'approved', approvedAt: now, replayed: false };
  });
}

export async function registerWait(db: Database, id: string, resumeUrl: string, now: Date) {
  const parsed = new URL(resumeUrl);
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.port !== '5678' || !parsed.pathname.startsWith('/webhook-waiting/')) throw new Error('invalid_resume_url');
  return db.transaction(async (tx) => {
    const [exercise] = await tx.select().from(waitExercises).where(eq(waitExercises.id, id));
    if (!exercise) return null;
    if (exercise.expiresAt <= now && exercise.status === 'pending') {
      await tx.update(waitExercises).set({ status: 'expired' }).where(eq(waitExercises.id, id));
      throw new Error('wait_expired');
    }
    if (exercise.resumeUrl && exercise.resumeUrl !== resumeUrl) throw new Error('resume_url_conflict');
    await tx.update(waitExercises).set({ resumeUrl }).where(eq(waitExercises.id, id));
    return { exerciseId: id, status: exercise.status, approvalRecorded: ['approved', 'callback_sent', 'completed'].includes(exercise.status) };
  });
}

export async function resumeWait(db: Database, id: string, now: Date) {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`SELECT * FROM wait_exercises WHERE id=${id} FOR UPDATE`);
    const exercise = rows.rows[0] as { status: string; resume_url: string | null; expires_at: Date; callback_attempts: number } | undefined;
    if (!exercise) return null;
    if (exercise.status === 'completed') return { completed: true, replayed: true } as const;
    if (exercise.expires_at <= now) {
      await tx.update(waitExercises).set({ status: 'expired' }).where(eq(waitExercises.id, id));
      throw new Error('wait_expired');
    }
    if (!['approved', 'callback_sent'].includes(exercise.status)) throw new Error('approval_required');
    if (!exercise.resume_url) throw new Error('wait_not_ready');
    await tx.update(waitExercises).set({ callbackAttempts: exercise.callback_attempts + 1 }).where(eq(waitExercises.id, id));
    return { completed: false, resumeUrl: exercise.resume_url, attempt: exercise.callback_attempts + 1 } as const;
  });
  if (!claimed || claimed.completed) return claimed;
  const response = await fetch(claimed.resumeUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exerciseId: id }) });
  if (!response.ok) {
    const [latest] = await db.select().from(waitExercises).where(eq(waitExercises.id, id));
    if (latest?.status === 'completed') return { completed: true, replayed: true };
    throw new Error('resume_callback_failed');
  }
  await db.update(waitExercises).set({ status: 'callback_sent' }).where(eq(waitExercises.id, id));
  return { completed: false, callbackAccepted: true, attempt: claimed.attempt };
}

export async function completeWait(db: Database, id: string, now: Date) {
  return db.transaction(async (tx) => {
    const [exercise] = await tx.select().from(waitExercises).where(eq(waitExercises.id, id));
    if (!exercise) return null;
    if (exercise.status === 'completed') return { exerciseId: id, status: 'completed', replayed: true };
    if (!exercise.approvedAt || !['approved', 'callback_sent'].includes(exercise.status)) throw new Error('approval_required');
    if (exercise.expiresAt <= exercise.approvedAt) throw new Error('wait_expired');
    await tx.update(waitExercises).set({ status: 'completed', completedAt: now }).where(eq(waitExercises.id, id));
    return { exerciseId: id, status: 'completed', replayed: false };
  });
}
