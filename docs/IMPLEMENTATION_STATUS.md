# Implementation status

Updated: 2026-09-18. Branch: `feat/automation-foundation`. All checkpoints are local.

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

See [local development](guides/LOCAL_DEVELOPMENT.md) for reproduction commands,
available endpoints and the current limitations.
