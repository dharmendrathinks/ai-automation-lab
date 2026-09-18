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

Next: milestone 2 implements durable outbox delivery, Workflow A and the
`FixtureProvider` decision path, including duplicate-event handling and recorded
triage/escalation evidence.

See [local development](guides/LOCAL_DEVELOPMENT.md) for reproduction commands,
available endpoints and the current limitations.
