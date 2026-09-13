# Implementation status

Updated: 2026-09-13. Branch: `feat/automation-foundation`. All checkpoints are local.

## Milestone 0 — complete

Annotated tag: `milestone-0-feasibility`.

The bounded Codex harness and 17 process tests are complete. The real preflight
stopped before inference because isolated runtime authentication was absent:
**zero model calls**. The [decision is frozen](decisions/0001-codex-feasibility.md).
Development proceeds in **FIXTURE MODE**. This does not establish live provider
feasibility or model quality. No video is warranted yet.

## Milestone 1 — first backend slice tested, milestone incomplete

Implemented:

- PostgreSQL schema, transactional migration and deterministic synthetic baseline.
- Fastify API with operator authentication and bounded, validated ticket input.
- Atomic ticket/run/audit/outbox creation; unresolved customers remain explicit.
- Read-only mock customer, subscription, invoice and payment APIs.
- A fresh PostgreSQL cluster for reproducible integration testing.

Actual validation on Node 26.5.0 / macOS ARM64 / PostgreSQL 17.9:

- `pnpm test:integration`: **12 passed**.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; migration and fixture assets included in build output.
- Forced outbox insert failure: API returned `500`; persisted ticket, run, audit
  and outbox counts were each **0** after rollback.
- Successful intake: each count was **1**, with a pending versioned event.
- Cross-customer payment ownership and excessive refunded amounts were rejected
  by PostgreSQL constraints.

These are deterministic backend tests, not model behavior or n8n executions.
No n8n workflow was added or changed. There is no milestone 1 tag and no video
checkpoint. No video is warranted yet.

Next: complete the local Docker/PostgreSQL/n8n bootstrap, prove host networking
and workflow import, and validate the planned Node 24 / PostgreSQL 18 baseline.
Docker is not installed on this machine, so those checks have not run. Then
continue with workflow A and `FixtureProvider` under the approved roadmap.

See [local development](guides/LOCAL_DEVELOPMENT.md) for reproduction commands,
available endpoints and the current limitations.
