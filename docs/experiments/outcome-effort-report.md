# Automation outcome and effort report

Historical experiment: 2026-09-18. Reporting correction: 2026-09-23.

## Human-effort measurement — September 24 remediation

Ticket detail → **Record effort** now records a cumulative observation in the
existing audit trail. Choose **Operator-reported observation** only for actual
timed work; the default is **Synthetic teaching example**. Include triage,
review, exception handling and recovery in total active minutes. Review minutes
are a subset, not an additional total. Approval turnaround remains elapsed time.

Supply the measurement method/scope and optionally a comparable manual-only
baseline with a reference and **measured** or **synthetic** provenance. Mark the
snapshot complete only after accounting for all work. Subsequent audited work
invalidates that completeness assertion; record a new cumulative snapshot.
Repeated submission of the same observation ID is idempotent, not extra effort.
The API is `POST /api/v1/tickets/:id/effort`, operator-authenticated; its strict
contract is in `apps/api/src/effort.ts`.

Run `pnpm report:outcomes` after recording observations. It separates fixture/live
cohorts and operator-reported/synthetic observations, reports coverage, retains
negative savings, and keeps cohort minutes N/A until every ticket is covered.
Matched savings require a verified resolution, complete effort and a baseline.
Recorded nonzero operator effort excludes a ticket from full automation, even
without an approval. Self-reported observations are not independently certified.

Reproducible arithmetic experiment (no live inference or measured labor):

```sh
pnpm test:integration
pnpm test:e2e --grep 'effort entry'
```

The database test verifies six synthetic active minutes including one review
minute against a five-minute synthetic baseline: **−1 minute**, not savings.
Synthetic examples never populate measured-labor totals. It separately tests
the operator-report contract using explicitly simulated data, partial coverage,
snapshot replacement and invalidation. These are software tests, not human-time
observations. Actual productivity remains unproven until a person supplies
matched manual and automation-assisted observations on the declared cohort.

No analytics service, new metrics table, fabricated dollar price, or architecture
change was introduced.

## Historical outcome evidence

The historical values below describe the original experiment, not a current
release signoff. The report now includes pending/failed tickets and shares the
dashboard's mode-separated definitions. It no longer infers zero human effort
from the absence of an approval. A synthetic manual baseline alone does not
establish savings; those measurements remain null until effort is observed.

The reproducible command is:

```sh
pnpm report:outcomes
```

After the Milestone 6 live verified-support scenario, the report observed one
`gpt-5.6-terra` ticket: automation rate 100%, verified-completion rate 100%,
human-escalation rate 0%, one verified action, 6,647 ms end-to-end handling time
and 6,517 ms provider latency. Provider usage was available; monetary cost was
not, so cost per resolution was N/A.

The supported ticket had no recorded human approval. That establishes the
recorded automated path, but does not measure direct or indirect human effort.
Estimated minutes saved remains N/A without observed effort and a comparable
manual baseline.

For teaching only, this command supplies an explicit synthetic/configurable
five-minute manual baseline:

```sh
LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES=5 pnpm report:outcomes
```

The baseline is retained as an explicit synthetic assumption, but no longer
yields a savings estimate without measured effort. It is not observed labor,
customer satisfaction, subscription cost, or dollar savings.

Answer to **“Did this automation actually remove human work while still
producing verified outcomes?”**: it produced one independently verified outcome
without a recorded approval. The amount of human time removed is not yet
measured, and no supported savings estimate is available. Broader claims
require matched manual observations and a larger resolved cohort.

The clean-clone fixture rehearsal also ran the report after the full reliability
suite. Its mixed four-ticket cohort correctly declined to claim removed human
work because active-effort coverage was incomplete, while retaining three
verified completions and one failed outcome in the denominator.
