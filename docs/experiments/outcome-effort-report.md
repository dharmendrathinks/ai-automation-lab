# Automation outcome and effort report

Date: 2026-09-18

The reproducible command is:

```sh
pnpm report:outcomes
```

After the Milestone 6 live verified-support scenario, the report observed one
`gpt-5.6-terra` ticket: automation rate 100%, verified-completion rate 100%,
human-escalation rate 0%, one verified action, 6,647 ms end-to-end handling time
and 6,517 ms provider latency. Provider usage was available; monetary cost was
not, so cost per resolution was N/A.

The supported ticket required no direct human ticket handling. That establishes
a verified automated outcome, but does not by itself quantify time saved. Without
a comparable manual baseline, estimated minutes saved remains N/A.

For teaching only, this command supplies an explicit synthetic/configurable
five-minute manual baseline:

```sh
LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES=5 pnpm report:outcomes
```

It yields an estimated five minutes saved for this single resolved scenario.
That is an experimental assumption—not observed labor, customer satisfaction,
subscription cost, or dollar savings.

Answer to **“Did this automation actually remove human work while still
producing verified outcomes?”**: it produced one independently verified outcome
without direct ticket handling. The amount of human time removed is not yet
measured; only an explicitly synthetic estimate is available. Broader claims
require matched manual observations and a larger resolved cohort.

The clean-clone fixture rehearsal also ran the report after the full reliability
suite. Its mixed four-ticket cohort correctly declined to claim removed human
work because active-effort coverage was incomplete, while retaining three
verified completions and one failed outcome in the denominator.
