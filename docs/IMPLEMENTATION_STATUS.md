# Implementation status

Updated: 2026-09-24. Branch: `feat/automation-foundation`. All checkpoints are local.

## Current assessment — not yet full plan completion

The numbered entries below preserve the historical implementation claims and
experiment evidence. Existing tags do **not** establish that every acceptance
criterion in `PLAN.md` is satisfied. There are nine numbered milestones (0–8).

The September 23–24 UI pass adds the planned ticket queue/detail, run evidence,
reviewer approval/history, and reliability scenario screens, plus overview and
outcome views. See [workspace guide](guides/WORKSPACE.md). It preserves Fastify,
PostgreSQL, n8n orchestration, fixture defaults, and backend authority; no frontend
server or analytics infrastructure was added. A forward migration permits the
existing run-mode field to accurately record live AI and repairs historical mode
labels only where provider metadata supplies evidence.

Dashboard and CLI report now share a mode-separated ticket denominator that
includes pending/failed work. Approved resolutions are not counted as fully
automated. Unobserved human effort is null, never inferred as zero. Reviewer
decisions are serialized per approval to prevent conflicting simultaneous votes.
Scenario configuration is now committed atomically with intake/outbox creation,
so the worker cannot observe a scenario ticket before its fault is persisted.
Validation: 32 unit/DOM tests, 21 isolated database tests, build, and typecheck;
the real n8n workspace smoke also passed all five support/lab paths. Details are
in the workspace guide. This does not close the remaining gates below.

The subsequent test-only pass adds 30 real-browser scenarios per project with
isolated PostgreSQL/n8n, an independent SQL oracle, contributor setup and CI.
Chromium, WebKit and mobile Chromium each pass 20 and fail 10; the failures expose
contrast, customer-reference validation and UI reconciliation defects. Firefox
cannot launch locally. See the [browser audit](experiments/ui-e2e-audit.md) for
reproduction and limitations. Unit/DOM/harness coverage now totals 40 passing
tests. No production code was changed in this test-only pass.

### September 24 blocker remediation (supersedes the audit failures above)

- Reconciliation, native validation, contrast and Firefox launch are fixed. The
  expanded **128-test browser matrix passes**; coverage adds effort entry,
  effort-dialog accessibility and real n8n persisted-Wait restart/replay.
- Human-effort capture is implemented through ticket detail and existing audit
  records. Cumulative observations carry provenance, completeness and matched
  baseline evidence; tests cover partial coverage, stale observations, negative
  savings, idempotency and fixture/live separation. No human labor was fabricated.
- Production provider tests now cover version preflight, malformed/oversized
  output, tool rejection, sanitized errors, queued cancellation, timeout,
  descendant cleanup and credential-environment isolation. Classification is
  serialized per run, invalid output retries once, and failure safely escalates.
- Execution is serialized per action with a persisted three-attempt limit;
  refund parameters/policy/payment evidence are revalidated. Concurrent refunds,
  competing actions, changed payloads, expiry persistence, Wait callback loss,
  terminal-state races and retry budgets have database regression tests.
- The evaluation corpus is now 100 distinct tickets: 20 development and 80
  held-out. It reports the splits separately with a corpus hash and explicit
  quality gate, not the historical repeated-example score.

Local validation: **58 unit/DOM/process/corpus tests, 35 isolated PostgreSQL
tests, 128 browser-stack tests**, build, application/E2E type checks and diff
whitespace checks pass. CI now also runs the database regression suite; remote
execution has not been claimed. All commits remain local and tags are unchanged.

Remaining evidence/signoff gates:

- Run the new held-out **live** cohort after explicit allowance approval. No new
  hosted inference was made during this remediation. Offline provider tests do
  not prove present live availability or held-out model quality.
- Gather actual matched manual/automation-assisted human-time observations.
  Capability and synthetic arithmetic are tested; real productivity is unproven.
- Complete human visual/screen-reader signoff. Screenshots have been inspected
  and automated axe/keyboard/viewport checks run, but this is not accessibility
  certification. Remote CI and x86/emulated Docker remain unvalidated.

No historical tag was changed and no new milestone-completion tag is warranted.

## Milestone 0 — complete

Annotated tag: `milestone-0-feasibility`.

The bounded Codex harness and 17 process tests are complete. The real preflight
stopped before inference because isolated runtime authentication was absent:
**zero model calls**. The [decision is frozen](decisions/0001-codex-feasibility.md).
Development proceeds in **FIXTURE MODE**. This does not establish live provider
feasibility or model quality. No video is warranted yet.

## Milestone 1 — complete

Annotated tag: `milestone-1-business-foundation`.

Implemented:

- PostgreSQL schema, transactional migration and deterministic synthetic baseline.
- Fastify API with operator authentication and bounded, validated ticket input.
- Atomic ticket/run/audit/outbox creation; unresolved customers remain explicit.
- Read-only mock customer, subscription, invoice and payment APIs.
- A fresh PostgreSQL cluster for reproducible integration testing.
- Digest-pinned native ARM64 PostgreSQL 18.6 and n8n 2.38.7 services.
- Separate PostgreSQL bootstrap, RelayDesk and n8n users; application users are
  not superusers and own separate databases.
- Generated local-only secrets, persistent volumes, health checks and
  loopback-only published ports.
- Idempotent setup, migrations, seed and reviewed workflow import.
- An inactive foundation workflow that reaches the loopback-bound host API
  through `host.docker.internal` and observes `FIXTURE MODE`.

Actual validation on macOS ARM64 with Docker Engine 29.5.2 and Compose 5.5.1:

- Node **24.21.0** container: **17 tests passed**, typecheck passed and build passed.
- PostgreSQL **18.6** container: **12 API integration tests passed**.
- n8n **2.38.7**: repeated setup retained exactly one imported foundation
  workflow; its real CLI execution completed successfully and read
  `{ service: "relaydesk", mode: "FIXTURE MODE" }` from the host API.
- Database roles confirmed `relaydesk` and `n8n` are not superusers.
- Forced outbox insert failure: API returned `500`; persisted ticket, run, audit
  and outbox counts were each **0** after rollback.
- Successful intake: each count was **1**, with a pending versioned event.
- Cross-customer payment ownership and excessive refunded amounts were rejected
  by PostgreSQL constraints.

These are deterministic foundation checks, not model behavior. The connectivity
workflow proves import/bootstrap and networking only; it is not Workflow A and
does not deliver the ticket outbox event. No video checkpoint was created. No
video is warranted yet.

Milestone 2 continues from this foundation below.

## Milestone 2 — complete

Annotated tag: `milestone-2-first-orchestration`.

Implemented durable, bounded outbox delivery to the authenticated
`relaydesk-triage` webhook. The reviewed Workflow A claims the event, requests a
deterministic structured decision from `FixtureProvider`, and invokes backend
policy. Runs retain the decision, policy version, outcome, provider duration and
escalation reason. Workflow claims and fixture jobs are unique per logical event
and task.

Actual n8n 2.38.7 integration evidence:

- An invoice-download ticket reached n8n and completed with the
  `automatic_support` policy route.
- Redelivering the same event retained exactly one workflow claim and one AI job.
- An unresolved customer routed to `human_follow_up` with reason
  `customer_identity`.
- The outbox event was marked delivered only after the webhook returned success.

This is deterministic **FIXTURE MODE** behavior and does not measure model
accuracy. Milestone 3 will turn the authorized support route into a canonical
destination response and independently verify it. No video is warranted yet.

## Milestone 3 — complete

Annotated tag: `milestone-3-verified-response`.

The automatic-support policy route now creates a durable action and versioned
`action.ready` event. Workflow B claims that action, writes one canonical invoice
response with a stable idempotency key, then calls an independent read-path
verifier. Only the verified destination message resolves the ticket.

Actual evidence:

- The n8n action workflow stored exactly one customer-visible message.
- Verification read the ticket destination and matched the expected canonical text.
- The action outcome became `verified` and ticket resolution became `resolved`.
- Reprocessing created neither a second message nor a second operation receipt.
- `/dashboard` exposes the authenticated run timeline in a minimal local UI.
- `/api/v1/metrics/outcomes` reports fixture-mode automation, escalation,
  verified completion and handling-time data; missing human-effort evidence is N/A.

Milestone 4 adds exact refund proposals and human approval. No video is warranted yet.

## Milestone 4 — complete

Annotated tag: `milestone-4-approved-refund`.

Duplicate-charge policy now selects the later matching captured payment and
creates a frozen refund action plus approval record. Approval binds a canonical
parameter hash, expires after 24 hours, and is committed atomically with the
outgoing action event. The n8n credential cannot call the reviewer endpoint.
Workflow B revalidates payment and approval state, commits one refund using the
stable action key, reads billing state independently and posts a factual response.

Actual evidence:

- Before approval, the refund count remained zero.
- The restricted n8n token received `401` from the approval endpoint.
- Operator approval of the exact proposal refunded `PAY-002` for USD 29.00 once.
- Refund, payment total, action outcome and ticket resolution were independently
  read and recorded as verified.
- Approval elapsed time is reported separately; active human review minutes stay
  N/A until observed evidence exists.

Milestone 5 adds controlled failure, retry, recovery and unknown-outcome scenarios.
No video is warranted yet.

## Milestone 5 — complete

Annotated tag: `milestone-5-reliability-lab`.

Faults are explicit persisted scenario configuration with durable counters; ticket
text cannot enable them. Action attempts distinguish failure before commit,
committed response loss, false success, normal commit and idempotent replay.
Unknown verification remains unknown until an explicit reconciliation read.

Actual results from `pnpm test:reliability`:

- Failure before commit: two attempts, one refund, verified.
- Refund committed then response lost: two attempts, one operation receipt, one
  refund, verified through idempotent replay.
- Synthetic HTTP success without mutation: zero refunds and business outcome failed.
- Verification unavailable: one refund and unknown outcome; after n8n restart,
  reconciliation verified the same refund without another mutation.
- Outcome metrics expose failures, retries, ever/current unknown outcomes,
  recoveries and observed duplicate-prevention events.

The evidence is recorded in [reliability experiments](experiments/reliability-lab.md).
False-success and lost-response/idempotency are worthwhile video experiments;
their start/end tags and reproducible evidence are recorded in
[video checkpoints](VIDEO_CHECKPOINTS.md).

Milestone 6 reopened the bounded Codex decision for the concrete runtime
integration. Isolated ChatGPT authentication now works, CLI 0.155.0 produces
schema-valid `gpt-5.6-terra` decisions, and the provider-neutral backend path plus
20/100-call evaluation tooling are implemented. The 100-call live cohort reached
90% exact matches and 100% outcome-equivalent routing; cost remains unknown.

Colima supplied the local Docker runtime. The provider-neutral n8n workflow passed
in both fixture and live modes, and the live support path completed independent
read-back verification. Adversarial canary/write checks, cancellation, timeout,
process cleanup and provider-failure normalization passed. Milestone 6 is ready
for closeout; fixture mode remains the default and live mode remains explicit.

Milestone 7 adds a clearer evidence dashboard, fixture-first documentation and a
database-backed `pnpm report:outcomes` command. The report separates provider
modes, keeps missing cost/effort evidence as N/A and permits only an explicitly
labeled synthetic/configurable manual-time baseline. Its current evidence and
qualified answer are recorded in
[outcome and effort report](experiments/outcome-effort-report.md).

Clean-clone release rehearsal used fresh synthetic PostgreSQL/n8n volumes,
imported all three reviewed workflows and passed foundation, verified-support
and complete reliability demos without Codex credentials. The fixture report
showed missing effort and cost evidence as N/A. Milestone 7 is complete.

Milestone 8 adds an isolated native n8n webhook Wait exercise backed by the
existing PostgreSQL service. It passed approval-before-wait recovery, restart
while persisted, callback retry/race, duplicate replay and expiry scenarios.
The authenticated backend hides the resume URL and re-checks approval before
completion. Evidence is recorded in
[wait/resume experiment](experiments/wait-resume.md).

The historical closeout claimed all milestones complete. The current assessment
above supersedes that claim; remaining acceptance gates must be closed first.

See [local development](guides/LOCAL_DEVELOPMENT.md) for reproduction commands,
available endpoints and the current limitations.
