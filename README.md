# AI Automation Lab

A local, synthetic SaaS support lab for learning reliable AI business automation:
structured reasoning, deterministic workflows, human approval, idempotency and
independent outcome verification.

**FIXTURE MODE is the default.** An isolated, explicit **LIVE AI MODE** using
Codex CLI 0.155.0 and `gpt-5.6-terra` is also validated for local experiments.
No model credentials are required for the default setup or deterministic demos.

See the [original no-go](docs/decisions/0001-codex-feasibility.md), the
[Milestone 6 revalidation](docs/decisions/0002-codex-live-revalidation.md), and
the [live evaluation evidence](docs/experiments/live-ai-evaluation.md).

Implementation exists across milestones 0–8, but full acceptance is not yet
complete; see the [current release gates](docs/IMPLEMENTATION_STATUS.md).
RelayDesk stores a ticket, automation run, audit entry
and outbox event in one PostgreSQL transaction. The pinned PostgreSQL 18.6 and
n8n 2.38.7 services have reproducible local bootstrap, separate databases and
credentials, and a reviewed connectivity workflow that proves n8n can reach the
loopback-bound host API. Durable outbox delivery now invokes Workflow A, which
uses `FixtureProvider`, records a structured decision, applies backend policy and
suppresses duplicate logical work. Workflow B now stores a canonical support
message, reads it back through the destination API, and resolves the ticket only
after independent verification. Duplicate-charge cases now produce an immutable
refund proposal, require an exact human approval, execute idempotently, and are
verified through the billing read path. The reliability lab covers pre-commit
failure, committed-but-lost response, false success, unknown outcomes, restart
and safe reconciliation without duplicate refunds.

The same n8n workflows now use a backend-selected provider without knowing Codex
details. A historical 100-call evaluation over 20 repeated examples produced 90% exact structured matches and
100% outcome-equivalent safe routing; a live supported ticket was resolved only
after destination read-back verification. Provider monetary cost was unavailable
and is not invented. The September 24 evaluation of 20 development plus 80
distinct held-out tickets passed its held-out gate: 93.75% category accuracy,
100% allowed-action accuracy and 100% required-escalation recall. See the
[separate results and limitations](docs/experiments/live-ai-evaluation.md).

## Development

Use Node 24 LTS (the version in `.node-version`) and pnpm 10.30.1.

For the product UI, open **http://127.0.0.1:3001/dashboard** after starting the
API and outbox worker. The [workspace guide](docs/guides/WORKSPACE.md) covers
ticket creation, evidence, human approvals, failure experiments, and outcomes.
This is separate from the n8n editor and does not require n8n Assistant setup.

```sh
pnpm install
pnpm run doctor
pnpm run setup
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm test:foundation
pnpm test:triage
pnpm test:support
pnpm test:refund
pnpm test:reliability
pnpm test:wait-resume
pnpm report:outcomes
```

Default tests use fake processes and synthetic inputs; they do not call a model.
Live commands are separately named and require explicit environment configuration.

Run `pnpm test:baseline` with the repository's Node/pnpm versions to reproduce
lint, unit tests, application/browser type checks, build and database integration checks.
Database tests create and remove their own pinned PostgreSQL 18.6 container;
they require Docker, not `.env` or a running development stack. See
[local setup, endpoints and current limitations](docs/guides/LOCAL_DEVELOPMENT.md).

To reproduce the small economics/outcome report after a demo:

```sh
pnpm report:outcomes

# Optional experiment only; explicitly synthetic/configurable, not measured labor:
LAB_SYNTHETIC_MANUAL_SUPPORT_MINUTES=5 pnpm report:outcomes
```

The report answers whether verified automation occurred and exposes missing human
effort or cost evidence as `null`, never as zero. Record cumulative active effort
from ticket detail, with its source and matched baseline. Synthetic examples are
kept separate from operator-reported work. A baseline alone cannot establish
savings; see the [measurement protocol](docs/experiments/outcome-effort-report.md).

## Project guides

- [Architecture and implementation plan](PLAN.md)
- [Contributing](CONTRIBUTING.md)
- [Real-browser end-to-end testing](docs/guides/UI_TESTING.md)
- [Implementation status and evidence](docs/IMPLEMENTATION_STATUS.md)
- [Release checks and human signoff](docs/guides/RELEASE_SIGNOFF.md)
- [Repository workflow and evidence](docs/REPOSITORY_WORKFLOW.md)
- [Video checkpoints](docs/VIDEO_CHECKPOINTS.md)

Our original code is MIT-licensed. n8n is separately licensed under its
Sustainable Use License; hosted Codex access is governed by OpenAI's terms and
subscription limits. A subscription is not required for fixture-based tests.
