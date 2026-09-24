# Native n8n wait/resume exercise

Date: 2026-09-18  
Mode: **FIXTURE MODE**  
n8n: 2.38.7, PostgreSQL 18.6

## Question

Can a database-backed n8n Wait execution survive restart and resume safely when
approval and callbacks race, repeat, arrive late or lose their first response?

## Design

The authenticated backend owns the approval record, expiry and completion state.
n8n registers its unique `$execution.resumeUrl` with the backend and then enters
a ten-minute webhook Wait. The URL is never returned through the operator API.
After a callback, n8n asks the backend to complete; that endpoint independently
checks that approval was recorded before the callback attempt.

The resume webhook itself is not authorization. It is an opaque, signed n8n URL
kept behind the authenticated backend endpoint.

## Reproduction and actual result

September 24 remediation adds a disposable-stack command that does not restart
or truncate the developer's normal environment:

```sh
pnpm test:e2e --grep 'native n8n wait'
pnpm test:integration
```

The real n8n test passes approval-before-registration, persisted waiting state,
container restart, readiness recovery, concurrent callbacks and harmless replay.
The initial test exposed rejection of n8n's signed resume query; validation now
accepts only the pinned origin/path and optional single 64-hex signature. The
resume URL is absent from operator approval/replay responses as well as reads.
Callback retries have a persisted five-attempt budget and timed backoff in the
restart experiment. Database tests cover late/lost responses without regressing
completion, expiry committed before conflict, and duplicate completion races.
This is real restart evidence plus separately simulated transport-loss evidence,
not a claim to cover every host/network failure.

The older command below operates on the **normal local lab**, truncates its
Wait exercises and restarts its n8n container. Use only disposable synthetic data.

```sh
pnpm run setup
pnpm test:wait-resume
```

The test passed these synthetic scenarios:

- Approval before the Wait URL was registered, followed by safe resume.
- n8n restart while an execution was persisted in `waiting` state.
- A callback racing n8n startup recovery; the failed attempt was retained and
  retrying the same logical resume completed the original execution.
- Two concurrent resume attempts; one logical exercise completed once.
- A duplicate callback after completion returned a harmless replay result.
- Approval after expiry was rejected and persisted as expired.

PostgreSQL `execution_entity` showed the execution in `waiting` state across the
restart and later `success`. RelayDesk retained callback-attempt counts and the
authoritative completed state. No business action is attached to this teaching
exercise; the established outbox/approval/action pattern remains the production
design.
