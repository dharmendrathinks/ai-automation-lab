# AI Automation Lab

A local, synthetic SaaS support lab for learning reliable AI business automation:
structured reasoning, deterministic workflows, human approval, idempotency and
independent outcome verification.

**Under construction.** The bounded Codex feasibility check is frozen with live
runtime disabled: its isolated authentication gate was not satisfied. Development
continues in **FIXTURE MODE**. No live-AI evaluation is claimed.

See the [actual spike result and limitations](docs/decisions/0001-codex-feasibility.md).

## Development

Use Node 24 LTS (the version in `.node-version`) and pnpm 10.30.1.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Tests use fake processes and synthetic inputs; they do not call a model.

## Project guides

- [Architecture and implementation plan](PLAN.md)
- [Repository workflow and evidence](docs/REPOSITORY_WORKFLOW.md)
- [Video checkpoints](docs/VIDEO_CHECKPOINTS.md)

Our original code is MIT-licensed. n8n is separately licensed under its
Sustainable Use License; hosted Codex access is governed by OpenAI's terms and
subscription limits. A subscription is not required for fixture-based tests.
