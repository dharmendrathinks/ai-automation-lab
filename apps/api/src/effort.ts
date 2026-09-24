import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/index.js';
import { auditEvents, automationRuns } from './db/schema.js';

const minutes = z.number().finite().min(0).max(1440);
export const effortSchema = z
  .strictObject({
    observationId: z.uuid(),
    source: z.enum(['operator_reported', 'synthetic']),
    totalMinutes: minutes,
    reviewMinutes: minutes,
    complete: z.boolean(),
    note: z.string().trim().min(1).max(300),
    baseline: z
      .strictObject({
        kind: z.enum(['measured', 'synthetic']),
        minutes,
        reference: z.string().trim().min(1).max(120),
      })
      .nullable(),
  })
  .refine(
    (v) => v.reviewMinutes <= v.totalMinutes,
    'Review is part of total effort.',
  );
type Observation = z.infer<typeof effortSchema>;

export async function recordEffort(
  db: Database,
  ticketId: string,
  input: Observation,
  now: Date,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM tickets WHERE id=${ticketId} FOR UPDATE`,
    );
    const [run] = await tx
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.ticketId, ticketId))
      .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id))
      .limit(1);
    if (!run) return null;
    const [existing] = await tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, input.observationId));
    if (existing) {
      const prior = effortSchema.safeParse(
        (existing.evidence as { observation?: unknown }).observation,
      );
      if (
        existing.runId !== run.id ||
        existing.eventType !== 'effort.observed' ||
        !prior.success ||
        JSON.stringify(prior.data) !== JSON.stringify(input)
      )
        throw new Error('observation_conflict');
      return { observationId: input.observationId, replayed: true };
    }
    const version = await tx.execute(
      sql`SELECT count(*) FILTER(WHERE event_type <> 'effort.observed')::int AS count, count(*) FILTER(WHERE event_type='effort.observed')::int AS observations FROM audit_events WHERE run_id=${run.id}`,
    );
    const inserted = await tx
      .insert(auditEvents)
      .values({
        id: input.observationId,
        runId: run.id,
        actor: 'local-operator',
        eventType: 'effort.observed',
        evidence: {
          observation: input,
          workVersion: Number(version.rows[0]!.count),
          revision: Number(version.rows[0]!.observations) + 1,
        },
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: auditEvents.id });
    if (!inserted.length) throw new Error('observation_conflict');
    return { observationId: input.observationId, replayed: false };
  });
}

export async function effortMetrics(
  db: Database,
  mode: string,
  cutoff: Date,
  syntheticBaseline: number | null = null,
) {
  const result = await db.execute(sql`WITH cohort AS (
    SELECT t.id, t.status, r.id AS run_id,
      CASE WHEN j.provider='codex' THEN 'LIVE AI MODE' WHEN j.provider='fixture' THEN 'FIXTURE MODE' ELSE r.mode END AS mode
    FROM tickets t JOIN LATERAL (SELECT * FROM automation_runs WHERE ticket_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
    LEFT JOIN ai_jobs j ON j.run_id=r.id AND j.task='triage' WHERE t.created_at <= ${cutoff}
  ) SELECT c.*,
    (c.status='resolved' AND EXISTS(SELECT 1 FROM proposed_actions a WHERE a.run_id=c.run_id) AND NOT EXISTS(SELECT 1 FROM proposed_actions a WHERE a.run_id=c.run_id AND a.business_outcome <> 'verified')) AS verified,
    (SELECT count(*)::int FROM audit_events e WHERE e.run_id=c.run_id AND e.event_type <> 'effort.observed') AS work_version,
    (SELECT jsonb_agg(e.evidence ORDER BY (e.evidence->>'revision')::int DESC NULLS LAST, e.created_at DESC, e.id DESC) FROM audit_events e WHERE e.run_id=c.run_id AND e.event_type='effort.observed' AND e.created_at <= ${cutoff}) AS observations
    FROM cohort c WHERE c.mode=${mode}`);
  const summarize = (source: Observation['source']) => {
    let observed = 0,
      complete = 0,
      total = 0,
      review = 0;
    const savings = { measured: [] as number[], synthetic: [] as number[] };
    for (const row of result.rows) {
      const evidence = (
        row.observations as Array<{
          observation: unknown;
          workVersion: number;
        }> | null
      )?.find(
        (e) => effortSchema.safeParse(e.observation).data?.source === source,
      );
      const parsed = effortSchema.safeParse(evidence?.observation);
      if (!parsed.success) continue;
      const observation = parsed.data;
      observed++;
      total += observation.totalMinutes;
      review += observation.reviewMinutes;
      const covered =
        observation.complete &&
        evidence?.workVersion === Number(row.work_version);
      if (covered) complete++;
      const baseline =
        observation.baseline ??
        (syntheticBaseline === null
          ? null
          : { kind: 'synthetic' as const, minutes: syntheticBaseline });
      if (covered && row.verified && baseline)
        savings[baseline.kind].push(
          baseline.minutes - observation.totalMinutes,
        );
    }
    const average = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    return {
      source,
      observedTickets: observed,
      completeTickets: complete,
      cohortTickets: result.rows.length,
      observationCoverage: result.rows.length
        ? complete / result.rows.length
        : null,
      recordedTotalMinutes: observed ? total : null,
      recordedReviewMinutes: observed ? review : null,
      completeCohortMinutesPerTicket:
        result.rows.length && complete === result.rows.length
          ? total / result.rows.length
          : null,
      partialRecordedMinutesPerCohortTicket: observed
        ? total / result.rows.length
        : null,
      savings: {
        measured: {
          matchedResolvedTickets: savings.measured.length,
          minutesPerMatchedResolvedTicket: average(savings.measured),
        },
        synthetic: {
          matchedResolvedTickets: savings.synthetic.length,
          minutesPerMatchedResolvedTicket: average(savings.synthetic),
        },
      },
    };
  };
  return {
    observed: summarize('operator_reported'),
    synthetic: summarize('synthetic'),
    definition:
      'Latest cumulative snapshot per ticket/source; review is included in total. New work invalidates complete coverage. Operator-reported observations are not independently certified; synthetic observations never become measured labor. Savings cover matched verified tickets only; negative savings are retained.',
  };
}
