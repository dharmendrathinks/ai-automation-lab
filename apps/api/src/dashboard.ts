import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db/index.js';
import { effortMetrics } from './effort.js';
import {
  actionAttempts,
  aiJobs,
  approvals,
  automationRuns,
  customers,
  proposedActions,
  scenarioInstances,
  ticketMessages,
  tickets,
  workflowExecutions,
} from './db/schema.js';

// The UI is a same-origin client of the existing API, not a second application server.
const assets = new Map([
  ['/dashboard', ['index.html', 'text/html; charset=utf-8']],
  ['/dashboard/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/dashboard/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/dashboard/format.js', ['format.js', 'text/javascript; charset=utf-8']],
]);
export const publicDashboardPaths = new Set(assets.keys());
export function registerDashboard(app: FastifyInstance) {
  for (const [route, [filename, contentType]] of assets) {
    app.get(route, async (_request, reply) =>
      reply
        .header(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cache-Control', 'no-store')
        .type(contentType!)
        .send(
          await readFile(new URL(`../public/${filename}`, import.meta.url)),
        ),
    );
  }
}

export async function ticketQueue(db: Database) {
  const result = await db.execute(sql`SELECT t.*, c.name AS customer_name,
    r.id AS run_id, r.phase, r.outcome, r.escalation_reason,
    CASE WHEN j.provider = 'codex' THEN 'LIVE AI MODE' WHEN j.provider = 'fixture' THEN 'FIXTURE MODE' ELSE r.mode END AS mode,
    (SELECT count(*)::int FROM approvals p JOIN proposed_actions a ON a.id=p.action_id
      WHERE a.run_id=r.id AND p.status='pending' AND p.expires_at > now()) AS pending_approvals,
    (SELECT count(*)::int FROM proposed_actions a WHERE a.run_id=r.id AND a.business_outcome='verified') AS verified_actions
    FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id
    LEFT JOIN LATERAL (SELECT * FROM automation_runs WHERE ticket_id=t.id ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
    LEFT JOIN ai_jobs j ON j.run_id=r.id AND j.task='triage'
    ORDER BY t.created_at DESC, t.id DESC LIMIT 100`);
  return {
    tickets: result.rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      customerRef: r.customer_ref,
      customerName: r.customer_name,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
      runId: r.run_id,
      phase: r.phase,
      outcome: r.outcome,
      escalationReason: r.escalation_reason,
      mode: r.mode,
      pendingApprovals: r.pending_approvals,
      verifiedActions: r.verified_actions,
    })),
    limit: 100,
  };
}

export async function ticketDetail(db: Database, id: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!ticket) return null;
  const [customer] = ticket.customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, ticket.customerId))
    : [];
  return {
    ...ticket,
    customer: customer ?? null,
    runs: await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.ticketId, id))
      .orderBy(desc(automationRuns.createdAt)),
    messages: await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, id))
      .orderBy(asc(ticketMessages.createdAt)),
  };
}

export async function runEvidence(db: Database, runId: string) {
  const actions = await db
    .select()
    .from(proposedActions)
    .where(eq(proposedActions.runId, runId));
  const actionIds = actions.map((a) => a.id);
  const jobs = await db
    .select()
    .from(aiJobs)
    .where(eq(aiJobs.runId, runId))
    .orderBy(asc(aiJobs.createdAt));
  return {
    actions,
    jobs,
    approvals: actionIds.length
      ? await db
          .select()
          .from(approvals)
          .where(inArray(approvals.actionId, actionIds))
      : [],
    attempts: actionIds.length
      ? await db
          .select()
          .from(actionAttempts)
          .where(inArray(actionAttempts.actionId, actionIds))
          .orderBy(asc(actionAttempts.createdAt))
      : [],
    workflows: await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.runId, runId)),
    scenarios: await db
      .select()
      .from(scenarioInstances)
      .where(eq(scenarioInstances.runId, runId)),
  };
}

export async function approvalQueue(db: Database) {
  const rows = await db
    .select({
      approval: approvals,
      action: proposedActions,
      ticket: tickets,
      run: automationRuns,
    })
    .from(approvals)
    .innerJoin(proposedActions, eq(approvals.actionId, proposedActions.id))
    .innerJoin(automationRuns, eq(proposedActions.runId, automationRuns.id))
    .innerJoin(tickets, eq(automationRuns.ticketId, tickets.id))
    .orderBy(desc(approvals.requestedAt))
    .limit(100);
  // Preserve the original flat approval fields for CLI consumers.
  return {
    approvals: rows.map(({ approval, ...context }) => ({
      ...approval,
      ...context,
    })),
    limit: 100,
  };
}

export async function outcomeMetrics(
  db: Database,
  mode: 'FIXTURE MODE' | 'LIVE AI MODE',
  cutoff: Date,
  syntheticBaseline: number | null = null,
) {
  // One row per ticket: actions cannot inflate the denominator. Include pending and failed jobs.
  // Provider metadata takes precedence over legacy intake rows that were incorrectly fixture-labeled.
  const result = await db.execute(sql`WITH cohort AS (
    SELECT t.id, t.status, t.created_at, r.id AS run_id, j.duration_ms,
      CASE WHEN j.provider='codex' THEN 'LIVE AI MODE' WHEN j.provider='fixture' THEN 'FIXTURE MODE' ELSE r.mode END AS mode
    FROM tickets t JOIN LATERAL (SELECT * FROM automation_runs WHERE ticket_id=t.id ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
    LEFT JOIN ai_jobs j ON j.run_id=r.id AND j.task='triage' WHERE t.created_at <= ${cutoff}
  ), selected AS (SELECT * FROM cohort WHERE mode=${mode}), action_cohort AS (
    SELECT a.* FROM proposed_actions a JOIN selected c ON c.run_id=a.run_id
  ), verified_tickets AS (
    SELECT c.* FROM selected c WHERE c.status='resolved'
      AND EXISTS (SELECT 1 FROM action_cohort a WHERE a.run_id=c.run_id)
      AND NOT EXISTS (SELECT 1 FROM action_cohort a WHERE a.run_id=c.run_id AND a.business_outcome <> 'verified')
  ) SELECT
    (SELECT count(*)::int FROM selected) AS tickets,
    (SELECT count(*)::int FROM verified_tickets) AS resolved,
    (SELECT count(*)::int FROM verified_tickets c WHERE NOT EXISTS (SELECT 1 FROM approvals p JOIN action_cohort a ON a.id=p.action_id WHERE a.run_id=c.run_id) AND NOT EXISTS (SELECT 1 FROM audit_events e WHERE e.run_id=c.run_id AND e.event_type='effort.observed' AND e.evidence->'observation'->>'source'='operator_reported' AND (e.evidence->'observation'->>'totalMinutes')::numeric > 0)) AS automated,
    (SELECT count(*)::int FROM selected WHERE status='human_follow_up') AS escalated,
    (SELECT count(*)::int FROM action_cohort WHERE business_outcome='verified') AS verified_actions,
    (SELECT avg(EXTRACT(EPOCH FROM ((SELECT max(a.updated_at) FROM action_cohort a WHERE a.run_id=c.run_id)-c.created_at))*1000) FROM verified_tickets c) AS handling_ms,
    (SELECT avg(EXTRACT(EPOCH FROM (p.decided_at-p.requested_at))*1000) FROM approvals p JOIN action_cohort a ON a.id=p.action_id WHERE p.decided_at IS NOT NULL AND p.status IN ('approved','rejected')) AS approval_ms,
    (SELECT avg(j.duration_ms) FROM ai_jobs j JOIN selected c ON c.run_id=j.run_id) AS provider_ms,
    (SELECT count(*)::int FROM ai_jobs j JOIN selected c ON c.run_id=j.run_id) AS provider_attempts,
    (SELECT count(*)::int FROM ai_jobs j JOIN selected c ON c.run_id=j.run_id WHERE j.status='failed') AS provider_failures,
    (SELECT count(*)::int FROM ai_jobs j JOIN selected c ON c.run_id=j.run_id WHERE j.task='triage-invalid-output-retry') AS provider_retries,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ((SELECT max(a.updated_at) FROM action_cohort a WHERE a.run_id=c.run_id)-c.created_at))*1000) FROM verified_tickets c) AS handling_median_ms,
    (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ((SELECT max(a.updated_at) FROM action_cohort a WHERE a.run_id=c.run_id)-c.created_at))*1000) FROM verified_tickets c) AS handling_p95_ms,
    (SELECT max(EXTRACT(EPOCH FROM (${cutoff}::timestamptz-created_at))*1000) FROM selected WHERE status <> 'resolved') AS oldest_unresolved_ms,
    (SELECT count(*)::int FROM action_cohort a WHERE EXISTS (SELECT 1 FROM action_attempts x WHERE x.action_id=a.id)) AS attempted,
    (SELECT count(*)::int FROM action_cohort WHERE business_outcome='failed') AS failed,
    (SELECT count(*)::int FROM action_cohort a WHERE (SELECT count(*) FROM action_attempts x WHERE x.action_id=a.id)>1) AS retried,
    (SELECT count(*)::int FROM action_cohort WHERE business_outcome='unknown') AS unknown,
    (SELECT count(DISTINCT e.run_id)::int FROM audit_events e JOIN selected c ON c.run_id=e.run_id WHERE e.event_type='verification.unknown') AS ever_unknown,
    (SELECT count(*)::int FROM action_cohort a WHERE business_outcome='verified' AND (EXISTS (SELECT 1 FROM action_attempts x WHERE x.action_id=a.id AND x.result IN ('failed_before_commit','committed_response_lost')) OR EXISTS (SELECT 1 FROM audit_events e WHERE e.run_id=a.run_id AND e.event_type='verification.unknown'))) AS recovered,
    (SELECT count(*)::int FROM action_cohort a WHERE a.business_outcome IN ('failed','unknown') OR EXISTS (SELECT 1 FROM action_attempts x WHERE x.action_id=a.id AND x.result IN ('failed_before_commit','committed_response_lost')) OR EXISTS (SELECT 1 FROM audit_events e WHERE e.run_id=a.run_id AND e.event_type='verification.unknown')) AS recovery_needed,
    (SELECT count(*)::int FROM audit_events e JOIN selected c ON c.run_id=e.run_id WHERE e.event_type='duplicate.event_suppressed') +
    (SELECT count(*)::int FROM action_attempts x JOIN action_cohort a ON a.id=x.action_id WHERE x.result='idempotent_replay') AS duplicates`);
  const r = result.rows[0]!;
  const number = (key: string) => (r[key] == null ? null : Number(r[key]));
  const count = (key: string) => number(key) ?? 0;
  const rate = (key: string, denominator: string) =>
    count(denominator) ? count(key) / count(denominator) : null;
  const humanEffort = await effortMetrics(db, mode, cutoff, syntheticBaseline);
  return {
    mode,
    cohort: {
      tickets: count('tickets'),
      cutoff: cutoff.toISOString(),
      definition:
        'All tickets received through cutoff, latest run per ticket; includes pending and failed work. Current state at query time.',
    },
    automationRate: rate('automated', 'tickets'),
    humanEscalationRate: rate('escalated', 'tickets'),
    verifiedCompletionRate: rate('resolved', 'tickets'),
    automatedTickets: count('automated'),
    resolvedTickets: count('resolved'),
    escalatedTickets: count('escalated'),
    verifiedActions: count('verified_actions'),
    meanHandlingMs: number('handling_ms'),
    handling: {
      samples: count('resolved'),
      medianMs: number('handling_median_ms'),
      p95Ms: number('handling_p95_ms'),
      oldestUnresolvedMs: number('oldest_unresolved_ms'),
    },
    meanApprovalElapsedMs: number('approval_ms'),
    meanProviderLatencyMs: number('provider_ms'),
    providerAttempts: {
      total: count('provider_attempts'),
      failed: count('provider_failures'),
      retries: count('provider_retries'),
    },
    humanEffort,
    activeReviewMinutes: humanEffort.observed.recordedReviewMinutes,
    humanMinutesPerTicket: humanEffort.observed.completeCohortMinutesPerTicket,
    estimatedHumanMinutesSaved:
      humanEffort.observed.savings.measured.minutesPerMatchedResolvedTicket,
    modelCost: null,
    costPerResolvedTicket: null,
    reliability: {
      attemptedActions: count('attempted'),
      failureRate: rate('failed', 'attempted'),
      failedActions: count('failed'),
      retriedActions: count('retried'),
      retryRate: rate('retried', 'attempted'),
      everUnknown: count('ever_unknown'),
      currentUnknown: count('unknown'),
      unknownOutcomeRate: rate('unknown', 'attempted'),
      recoveredActions: count('recovered'),
      recoveryRate: rate('recovered', 'recovery_needed'),
      actionsNeedingRecovery: count('recovery_needed'),
      duplicatePreventionEvents: count('duplicates'),
    },
  };
}
