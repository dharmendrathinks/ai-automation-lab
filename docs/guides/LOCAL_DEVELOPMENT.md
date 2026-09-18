# Local development

Status: **milestone 1 complete**, **FIXTURE MODE**. Live inference remains
disabled. The imported foundation workflow checks installation and networking;
ticket event delivery and Workflow A begin in milestone 2.

## Prerequisites and one-time setup

Install Node 24 LTS, pnpm 10.30.1, a Docker engine and the Docker Compose plugin.
Docker Desktop is the default in the plan; the recorded ARM64 validation also
passed with Colima. Confirm the local tools, then bootstrap the lab:

```sh
pnpm install
pnpm run doctor
pnpm run setup
```

`pnpm run setup` creates a private `.env` only when it is absent, using separate
random credentials for the PostgreSQL bootstrap administrator, RelayDesk, n8n,
the n8n encryption key and the API operator. It starts digest-pinned PostgreSQL
18.6 and n8n 2.38.7 images, waits for health, migrates and seeds RelayDesk, then
imports the reviewed definitions under `workflows/definitions/`. Repeating setup
is safe and updates the fixed workflow identity rather than creating duplicates.

PostgreSQL is published on `127.0.0.1:55432` to avoid a common collision with a
native server on 5432. n8n is published on `127.0.0.1:5678`. Both application
users own only their respective databases and are not PostgreSQL superusers.
The n8n editor may request one-time local owner creation when first opened; CLI
workflow import and tests do not depend on that browser step.

Do not place Codex credentials in `.env`. Do not commit `.env` or the persistent
Docker volumes.

## Run and verify

After setup, start the infrastructure and host API together:

```sh
pnpm dev
```

Normal startup preserves data and does not regenerate secrets, reset databases
or invoke a model. Run these checks in another terminal:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:foundation
```

`pnpm test:foundation` starts the API on loopback, runs the actual imported n8n
workflow and requires a successful `FIXTURE MODE` health response. This proves
container-to-host networking through `host.docker.internal`; it does not claim
ticket orchestration or live AI behavior.

For the exact planned baseline, keep the infrastructure running and use:

```sh
pnpm test:baseline
```

That command runs the deterministic tests, typecheck and build in the pinned
Node 24.21.0 ARM64 container, then runs the 12 API integration tests against the
PostgreSQL 18.6 service. Its temporary dependency volume is deleted afterward.
For a native isolated PostgreSQL cluster, `pnpm test:integration` remains
available when `initdb` and `pg_ctl` are installed; set `LAB_PG_BIN` if they are
outside the Homebrew PostgreSQL 17 path.

Useful infrastructure commands:

```sh
pnpm infra:up
pnpm workflows:import
pnpm workflows:list
pnpm infra:down
```

Use `pnpm run setup` and `pnpm run doctor` with the explicit `run`: bare
`pnpm setup` and `pnpm doctor` are pnpm commands rather than project scripts.
`infra:down` stops containers but retains both named volumes. Resetting synthetic
state is intentionally not automated yet.

## API and synthetic fixture

The server binds to `127.0.0.1:3001`. `/healthz` is public; all other endpoints
need `Authorization: Bearer <LAB_OPERATOR_TOKEN>`. This is a local operator
credential, not customer authentication or the future restricted n8n action
credential.

| Method and path | Purpose |
|---|---|
| `GET /healthz` | Process health and fixture-mode label |
| `GET /readyz` | Database connectivity |
| `POST /api/v1/tickets` | Atomic ticket intake |
| `GET /api/v1/tickets` | Latest 100 tickets |
| `GET /api/v1/tickets/:id` | Ticket detail |
| `GET /api/v1/runs/:id` | Pending run, audit and outbox events |
| `GET /integrations/v1/customers/:id` | Mock customer record |
| `GET /integrations/v1/customers/:id/payments` | Customer payment context |
| `GET /integrations/v1/customers/:id/subscription` | Subscription context |
| `GET /integrations/v1/invoices/:id` | Invoice context |
| `GET /integrations/v1/payments/:id` | Payment context |

Submit this synthetic ticket with the operator token:

```json
{
  "customerRef": "CUSTOMER-001",
  "message": "I was charged twice this month and my account still says Free."
}
```

A `201` response returns `ticketId`, `runId` and `eventId`. Milestone 1 leaves
the run and versioned `ticket.created` outbox event pending. No model,
classification, refund or account change occurs. Retrying intake currently
creates another ticket; request deduplication is not implemented.

The `relaydesk-baseline-v1` fixture contains two fictional customers,
subscriptions, invoices and three captured payments. `CUSTOMER-001` has two
payments against the same invoice and a free effective account plan with a paid
subscription. These are investigation inputs, not proof that a refund is allowed.

The migration is transactional and checksum-checked. Re-running setup inserts
missing fixture IDs without resetting existing records. Applied migrations are
immutable; add a new migration for future schema changes.
