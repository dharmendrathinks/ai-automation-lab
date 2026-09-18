# AI Automation Lab

A local, synthetic SaaS support lab for learning reliable AI business automation:
structured reasoning, deterministic workflows, human approval, idempotency and
independent outcome verification.

**Under construction.** The bounded Codex feasibility check is frozen with live
runtime disabled: its isolated authentication gate was not satisfied. Development
continues in **FIXTURE MODE**. No live-AI evaluation is claimed.

See the [actual spike result and limitations](docs/decisions/0001-codex-feasibility.md).

Milestone 2 is complete. RelayDesk stores a ticket, automation run, audit entry
and outbox event in one PostgreSQL transaction. The pinned PostgreSQL 18.6 and
n8n 2.38.7 services have reproducible local bootstrap, separate databases and
credentials, and a reviewed connectivity workflow that proves n8n can reach the
loopback-bound host API. Durable outbox delivery now invokes Workflow A, which
uses `FixtureProvider`, records a structured decision, applies backend policy and
suppresses duplicate logical work.

## Development

Use Node 24 LTS (the version in `.node-version`) and pnpm 10.30.1.

```sh
pnpm install
pnpm run doctor
pnpm run setup
pnpm test
pnpm typecheck
pnpm build
pnpm test:foundation
pnpm test:triage
```

Tests use fake processes and synthetic inputs; they do not call a model.

Run `pnpm test:baseline` to reproduce unit, type, build and database integration
checks on Node 24.21.0 and the running PostgreSQL 18.6 container. See
[local setup, endpoints and current limitations](docs/guides/LOCAL_DEVELOPMENT.md).

## Project guides

- [Architecture and implementation plan](PLAN.md)
- [Implementation status and evidence](docs/IMPLEMENTATION_STATUS.md)
- [Repository workflow and evidence](docs/REPOSITORY_WORKFLOW.md)
- [Video checkpoints](docs/VIDEO_CHECKPOINTS.md)

Our original code is MIT-licensed. n8n is separately licensed under its
Sustainable Use License; hosted Codex access is governed by OpenAI's terms and
subscription limits. A subscription is not required for fixture-based tests.
