import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  CodexProvider,
  type ProviderResult,
} from '../apps/api/src/providers.js';
import { developmentCases } from '../fixtures/evaluation/development.js';
import { heldOutCases } from '../fixtures/evaluation/held-out.js';

if (process.env.LAB_CODEX_LIVE !== '1')
  throw new Error(
    'Live evaluation is opt-in: set LAB_CODEX_LIVE=1. No provider calls were made.',
  );
const arguments_ = process.argv.slice(2).filter((value) => value !== '--');
if (
  arguments_.length > 1 ||
  (arguments_[0] && !['20', '100'].includes(arguments_[0]))
)
  throw new Error(
    'Choose 20 development calls or 100 calls (20 development + 80 held-out).',
  );
const executable = process.env.LAB_CODEX_BIN;
if (!executable)
  throw new Error('Set LAB_CODEX_BIN to an absolute pinned Codex CLI path.');
const provider = new CodexProvider(
  executable,
  resolve(process.env.LAB_CODEX_HOME ?? '.local/codex-runtime'),
);
const cases =
  arguments_[0] === '100'
    ? [...developmentCases, ...heldOutCases]
    : developmentCases;
const results: Array<{
  id: string;
  split: string;
  categoryCorrect: boolean;
  intentCorrect: boolean;
  actionCorrect: boolean;
  expectedEscalation: boolean;
  actualEscalation: boolean;
  durationMs: number;
  usage: ProviderResult['usage'];
  error: string | null;
}> = [];
for (const sample of cases) {
  const started = performance.now();
  try {
    const result = await provider.classify({
      ticket: {
        id: sample.id,
        customerRef: sample.customerResolved ? 'CUSTOMER-001' : 'MISSING',
        message: sample.message,
      },
      customerResolved: sample.customerResolved,
      payments: sample.intents.includes('duplicate_charge')
        ? [
            {
              id: 'PAY-001',
              invoiceId: 'INV-001',
              amountMinor: 2900,
              currency: 'USD',
              status: 'captured',
            },
            {
              id: 'PAY-002',
              invoiceId: 'INV-001',
              amountMinor: 2900,
              currency: 'USD',
              status: 'captured',
            },
          ]
        : [],
    });
    results.push({
      id: sample.id,
      split: sample.id.startsWith('held-out-') ? 'held-out' : 'development',
      categoryCorrect: sample.categories.includes(result.decision.category),
      intentCorrect: sample.intents.includes(result.decision.intent),
      actionCorrect:
        result.decision.recommendedAction === sample.action &&
        result.decision.needsHumanReview === sample.review,
      expectedEscalation: sample.action === 'escalate',
      actualEscalation: result.decision.recommendedAction === 'escalate',
      durationMs: result.durationMs,
      usage: result.usage,
      error: null,
    });
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : 'provider_unavailable';
    results.push({
      id: sample.id,
      split: sample.id.startsWith('held-out-') ? 'held-out' : 'development',
      categoryCorrect: false,
      intentCorrect: false,
      actionCorrect: false,
      expectedEscalation: sample.action === 'escalate',
      actualEscalation: false,
      durationMs: Math.round(performance.now() - started),
      usage: null,
      error: code,
    });
    // Configuration/auth/quota/security failures cannot be repaired by spending the remaining budget.
    if (
      [
        'authentication_required',
        'unsupported_capability',
        'quota_exceeded',
        'security_violation',
      ].includes(code)
    )
      break;
  }
  process.stderr.write(
    `${results.length}/${cases.length} synthetic evaluations complete\n`,
  );
}
const summaries = ['development', 'held-out'].map((split) => {
  const cohort = results.filter((r) => r.split === split);
  const planned = cases.filter(
    (c) => c.id.startsWith('held-out-') === (split === 'held-out'),
  ).length;
  const rate = (n: number, d = planned) => (d ? n / d : null);
  const truePositives = cohort.filter(
    (r) => r.expectedEscalation && r.actualEscalation,
  ).length;
  const timings = cohort.map((r) => r.durationMs).sort((a, b) => a - b);
  const percentile = (p: number) =>
    timings.length ? timings[Math.ceil(timings.length * p) - 1] : null;
  return {
    split,
    planned,
    completed: cohort.length,
    latencyMs: {
      samples: timings.length,
      median: percentile(0.5),
      p95: percentile(0.95),
      includesFailures: true,
    },
    categoryAccuracy: rate(cohort.filter((r) => r.categoryCorrect).length),
    intentAccuracy: rate(cohort.filter((r) => r.intentCorrect).length),
    allowedActionAccuracy: rate(cohort.filter((r) => r.actionCorrect).length),
    escalationPrecision: rate(
      truePositives,
      cohort.filter((r) => r.actualEscalation).length,
    ),
    escalationRecall: rate(
      truePositives,
      cases.filter(
        (c) =>
          c.id.startsWith('held-out-') === (split === 'held-out') &&
          c.action === 'escalate',
      ).length,
    ),
    providerFailures: cohort.filter((r) => r.error).length,
    invalidOutput: cohort.filter((r) => r.error === 'invalid_output').length,
  };
});
const heldOut = summaries.find((s) => s.split === 'held-out')!;
const passed =
  heldOut.planned === 80 &&
  heldOut.completed === 80 &&
  heldOut.categoryAccuracy! >= 0.9 &&
  heldOut.allowedActionAccuracy! >= 0.85 &&
  heldOut.escalationRecall === 1 &&
  heldOut.providerFailures === 0;
console.log(
  JSON.stringify(
    {
      mode: provider.mode,
      model: provider.model,
      cli: '0.155.0',
      corpusVersion: 'triage-v2',
      corpusHash: createHash('sha256')
        .update(JSON.stringify(cases))
        .digest('hex'),
      requestedCalls: cases.length,
      actualCalls: results.length,
      splitResults: summaries,
      heldOutGatePassed: passed,
      scope:
        'Structured recommendation evaluation only. No business actions were executed; policy escapes and verified business outcomes are not measured by this report.',
      providerReportedCost: null,
      results,
    },
    null,
    2,
  ),
);
if (cases.length === 100 && !passed) process.exitCode = 1;
if (results.some((r) => r.error)) process.exitCode = 1;
