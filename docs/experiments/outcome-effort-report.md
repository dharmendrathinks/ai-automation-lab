# Automation outcome and effort report

Historical experiment: 2026-09-18. Reporting correction: 2026-09-23.

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
