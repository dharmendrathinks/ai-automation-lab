# Local development: first backend slice

Status: **milestone 1 in progress**, **FIXTURE MODE**. The API performs no inference
and does not yet dispatch events to n8n. It persists an event for later delivery.

## Install and test

Use Node from `.node-version` and pnpm 10.30.1:

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Run real database tests with a PostgreSQL installation whose `initdb` and `pg_ctl`
binaries are available. On this Mac the default is Homebrew PostgreSQL 17:

```sh
pnpm test:integration
```

On another machine, set `LAB_PG_BIN` to the directory containing those binaries:

```sh
LAB_PG_BIN=/usr/lib/postgresql/18/bin pnpm test:integration
```

The launcher creates a unique temporary cluster, selects a loopback port, runs
tests, stops that cluster and deletes its files. It never connects to an existing
application database. Run as an ordinary user; PostgreSQL refuses root. The
temporary test cluster uses trust authentication on loopback and contains only
synthetic data. Do not run it on an untrusted shared machine. Abruptly killing the
launcher may require cleaning up its `relaydesk-pg-*` temporary cluster manually.

## Run the API against your local development database

Provision a dedicated, empty PostgreSQL database and an application user that owns
that database. Never use a real customer database. Copy `.env.example` to `.env`,
set `DATABASE_URL`, and set `LAB_OPERATOR_TOKEN` to a random secret (for example,
generate one with `openssl rand -hex 32`). Keep `.env` local and private.

```sh
pnpm db:setup
pnpm dev:api
```

The server binds to `127.0.0.1:3001`. `/healthz` is public; all other endpoints need
`Authorization: Bearer <LAB_OPERATOR_TOKEN>`. This is a local operator credential,
not customer authentication or the future restricted n8n action credential.

Available endpoints:

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

Submit this JSON to ticket intake:

```json
{
  "customerRef": "CUSTOMER-001",
  "message": "I was charged twice this month and my account still says Free."
}
```

A `201` response returns `ticketId`, `runId` and `eventId`. Expect a pending run
and pending `ticket.created` event, not a completed automation. No model,
classification, refund or account change takes place. Retrying ticket creation
currently creates another ticket; intake request deduplication is not implemented.

The baseline fixture `relaydesk-baseline-v1` contains two fictional customers,
subscriptions, invoices and three captured payments. `CUSTOMER-001` has two
payments against the same invoice and a free account with a paid subscription.
Those are investigation inputs, not proof that any particular refund is allowed.

The migration is transactional and checksum-checked. Re-running setup inserts
missing fixture IDs without resetting existing records. Add a new migration to
change schema; do not edit an applied migration. SQL migrations are authoritative
for constraints, and Drizzle provides typed application access.

## Current validation and remaining work

The first slice was tested on Node **26.5.0** and native PostgreSQL **17.9**.
Node **24.21.0** and PostgreSQL **18.6** remain the planned baseline; compatibility
with that exact pair has not yet been demonstrated on this machine.

Docker is unavailable here. Compose configuration, pinned image digests, separate
n8n database credentials, n8n owner/bootstrap setup, workflow import and the
n8n-to-host networking check remain milestone 1 work. There are no committed
n8n workflow definitions yet. No milestone 1 tag is warranted until those checks
and the remaining foundation acceptance criteria pass.
