import { connect } from '../apps/api/src/db/index.js';
import { outcomeMetrics } from '../apps/api/src/dashboard.js';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL)
  throw new Error('DATABASE_URL is required. Run with --env-file=.env.');
const baselineText = process.env.LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES;
const syntheticBaseline =
  baselineText === undefined ? null : Number(baselineText);
if (
  syntheticBaseline !== null &&
  (!Number.isFinite(syntheticBaseline) || syntheticBaseline < 0)
)
  throw new Error(
    'LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES must be a nonnegative number.',
  );

const { db, pool } = connect(DATABASE_URL);
try {
  const cutoff = new Date();
  const cohorts = await Promise.all(
    (['FIXTURE MODE', 'LIVE AI MODE'] as const).map(async (mode) => ({
      ...(await outcomeMetrics(db, mode, cutoff, syntheticBaseline)),
      conclusion:
        'Consult observation coverage and matched-baseline sample counts. Synthetic estimates demonstrate arithmetic, not observed productivity; incomplete coverage cannot establish cohort-wide savings.',
    })),
  );
  const usage = await pool.query(
    `SELECT j.provider, j.model, count(*)::int AS recorded_jobs,
    count(*) FILTER (WHERE j.status='failed')::int AS failed_jobs,
    count(j.result->'usage'->>'inputTokens')::int AS jobs_with_usage,
    sum((j.result->'usage'->>'inputTokens')::bigint)::text AS known_input_tokens,
    sum((j.result->'usage'->>'outputTokens')::bigint)::text AS known_output_tokens
    FROM ai_jobs j JOIN automation_runs r ON r.id=j.run_id
    JOIN tickets t ON t.id=r.ticket_id WHERE t.created_at <= $1
    GROUP BY j.provider, j.model ORDER BY j.provider, j.model`,
    [cutoff],
  );
  console.log(
    JSON.stringify(
      {
        generatedAt: cutoff.toISOString(),
        assumptions: {
          syntheticManualSupportMinutes: syntheticBaseline,
          note: 'Any supplied baseline is synthetic/configurable, not observed labor or dollar savings. It cannot establish savings without measured human effort.',
        },
        cohorts,
        providerUsage: {
          coverage:
            'Recorded jobs only; known token totals may be partial. Null is unavailable, not zero. No token-to-dollar assumptions.',
          records: usage.rows,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
