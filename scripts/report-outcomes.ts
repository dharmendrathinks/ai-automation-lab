import { connect } from '../apps/api/src/db/index.js';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required. Run with --env-file=.env.');
const baselineText = process.env.LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES;
const syntheticBaseline = baselineText === undefined ? null : Number(baselineText);
if (syntheticBaseline !== null && (!Number.isFinite(syntheticBaseline) || syntheticBaseline < 0)) throw new Error('LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES must be a nonnegative number.');

const { pool } = connect(DATABASE_URL);
try {
  const result = await pool.query<{
    provider: string; model: string; tickets: number; resolved: number; escalated: number;
    automated_resolved: number; verified_actions: number; attempted_actions: number;
    mean_handling_ms: string | null; mean_provider_ms: string | null;
    input_tokens: string | null; cached_input_tokens: string | null; output_tokens: string | null;
  }>(`SELECT
    j.provider, j.model,
    count(DISTINCT t.id)::int AS tickets,
    count(DISTINCT t.id) FILTER (WHERE t.status='resolved')::int AS resolved,
    count(DISTINCT t.id) FILTER (WHERE t.status='human_follow_up')::int AS escalated,
    count(DISTINCT t.id) FILTER (WHERE t.status='resolved' AND ap.id IS NULL)::int AS automated_resolved,
    count(DISTINCT a.id) FILTER (WHERE a.business_outcome='verified')::int AS verified_actions,
    count(DISTINCT a.id)::int AS attempted_actions,
    avg(EXTRACT(EPOCH FROM (a.updated_at - t.created_at)) * 1000) FILTER (WHERE a.business_outcome='verified') AS mean_handling_ms,
    avg(j.duration_ms) AS mean_provider_ms,
    sum(COALESCE((j.result->'usage'->>'inputTokens')::bigint, 0))::text AS input_tokens,
    sum(COALESCE((j.result->'usage'->>'cachedInputTokens')::bigint, 0))::text AS cached_input_tokens,
    sum(COALESCE((j.result->'usage'->>'outputTokens')::bigint, 0))::text AS output_tokens
  FROM ai_jobs j
  JOIN automation_runs r ON r.id=j.run_id
  JOIN tickets t ON t.id=r.ticket_id
  LEFT JOIN proposed_actions a ON a.run_id=r.id
  LEFT JOIN approvals ap ON ap.action_id=a.id AND ap.status='approved'
  WHERE j.status='completed'
  GROUP BY j.provider, j.model
  ORDER BY j.provider, j.model`);

  const cohorts = result.rows.map((row) => {
    const mode = row.provider === 'fixture' ? 'FIXTURE MODE' : 'LIVE AI MODE';
    const automationRate = row.tickets ? row.automated_resolved / row.tickets : null;
    const verifiedCompletionRate = row.tickets ? row.resolved / row.tickets : null;
    const humanEscalationRate = row.tickets ? row.escalated / row.tickets : null;
    const observedDirectHumanMinutes = row.automated_resolved === row.tickets ? 0 : null;
    const estimatedMinutesSavedPerResolved = syntheticBaseline !== null && observedDirectHumanMinutes !== null && row.resolved ? syntheticBaseline - observedDirectHumanMinutes : null;
    return {
      mode, provider: row.provider, model: row.model, sampleSize: row.tickets,
      automationRate, humanEscalationRate, verifiedCompletionRate,
      verifiedActions: row.verified_actions, attemptedActions: row.attempted_actions,
      meanHandlingMs: row.mean_handling_ms === null ? null : Number(row.mean_handling_ms),
      meanProviderLatencyMs: row.mean_provider_ms === null ? null : Number(row.mean_provider_ms),
      humanEffort: {
        observedDirectHumanMinutesPerTicket: observedDirectHumanMinutes,
        coverage: observedDirectHumanMinutes === null ? 'incomplete: escalated/assisted active effort was not sampled' : 'direct ticket handling for fully automated cohort only',
        syntheticManualBaselineMinutes: syntheticBaseline,
        estimatedMinutesSavedPerSuccessfullyResolvedTicket: estimatedMinutesSavedPerResolved,
      },
      usage: row.provider === 'codex' ? { inputTokens: Number(row.input_tokens ?? 0), cachedInputTokens: Number(row.cached_input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0) } : null,
      providerReportedCost: null,
      costPerSuccessfullyResolvedTicket: null,
      conclusion: row.automated_resolved > 0 && row.resolved === row.automated_resolved
        ? 'Verified automation occurred without direct ticket handling; actual time savings require a measured or explicitly synthetic manual baseline.'
        : 'The cohort does not establish that automation removed human work while preserving verified outcomes.',
    };
  });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), assumptions: { syntheticManualSupportMinutes: syntheticBaseline, note: syntheticBaseline === null ? 'No manual-time baseline supplied; savings are N/A.' : 'Synthetic/configurable experimental assumption, not observed labor or dollar savings.' }, cohorts }, null, 2));
} finally {
  await pool.end();
}
