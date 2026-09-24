# RelayDesk workspace

Open **http://127.0.0.1:3001/dashboard**. This is the RelayDesk product UI;
the separate n8n editor at port 5678 is for inspecting orchestration, not ticket intake.

## Start locally

After the one-time `pnpm run setup`, apply current migrations and run:

```sh
pnpm db:setup
pnpm dev:api
```

In a second terminal:

```sh
pnpm worker:outbox
```

Infrastructure must also be running (`pnpm infra:up`). Connect the workspace using
the **LAB_OPERATOR_TOKEN** from the local `.env` file. Do not enter a provider API
key or an n8n credential. The token is retained only in tab memory, never in URL,
local storage, session storage, or the server-delivered HTML. Refreshing or
disconnecting clears it. This remains a local synthetic lab, not production auth.

Cancel or Escape during connection discards that attempt, even if readiness
responds later. Closing a submitted ticket/review/effort dialog does **not** cancel
the server write. A late response leaves any new draft/dialog untouched; inspect
the queue or refresh the workspace before retrying, rather than assuming failure.

## Screens

| View | What to try |
|---|---|
| Overview | Inspect actual cohort metrics, recent tickets, and pending approvals. |
| Tickets | Create an invoice-download request, filter/search the newest 100 tickets, then open its conversation. |
| Run evidence | Follow structured decision, policy, authorization, action attempts, verification, and expandable durable audit evidence. |
| Approvals | Review the exact customer/payment/amount/hash; explicitly approve or reject with a reason. Inspect decision history. |
| Reliability lab | Confirm a fixture-only support experiment, run it, and inspect observed results. Expected results are not presented as evidence. |
| Outcomes | Switch fixture/live cohorts and read definitions, denominators, cutoff, reliability, and missing-cost/effort disclosures. |

Invoice support is repeatable without consuming the baseline refund fixture.
The duplicate-charge example requires an eligible, not-yet-refunded payment
within the policy age window. A used or aged baseline is not automatically reset.
The UI never approves on your behalf, performs a direct destination write, or
replaces n8n orchestration. If a new ticket remains pending, check the outbox
worker, infrastructure, and imported/published workflows.

Approval turnaround is wall-clock queue plus review time, **not active effort**.
Unmeasured effort, savings, and cost remain N/A. The CLI outcome report uses the
same definitions. A supplied synthetic manual baseline alone cannot establish
minutes saved. Provider usage is shown when recorded, with partial coverage labeled.

## Implementation and design

The same Fastify server serves four allowlisted static files from
`apps/api/public`. There is no new runtime package, frontend framework, analytics
service, CDN, remote font, or telemetry. Browser modules call authenticated
same-origin APIs. CSP disallows inline scripts and third-party connections, and
API-sourced strings are escaped before markup insertion.

The responsive visual system uses a dark navigation rail, warm neutral surfaces,
restrained coral actions, and text-labeled outcome colors. Layout changes at
1150px and 760px. Native modal dialogs, visible focus rings, labeled controls,
semantic tables, reduced-motion support, and loading/empty/error states are
included. Polling pauses while a dialog, keyboard-focused control, or expanded
evidence is being read. Tokens and business data are not embedded in static assets.

## Verification

```sh
pnpm lint
pnpm test              # includes isolated DOM interaction and escaping tests
pnpm test:integration  # creates and removes its own temporary PostgreSQL cluster
pnpm typecheck
pnpm build
# Requires running API, worker, and n8n; retains five new synthetic tickets
pnpm test:workspace
```

DOM tests cover primary navigation, connect/disconnect, ticket intake/detail,
search, explicit review decisions, scenario launch, and recoverable errors.
API tests cover auth boundaries, linked evidence, mode separation, N/A handling,
denominators, concurrent conflicting reviewers, and false success.
`test:workspace` drives real n8n orchestration for normal support and all four
UI lab scenarios; it refuses live mode and does not reset existing data.

Actual verification on 2026-09-24: **32 unit/DOM tests** and **21 isolated
PostgreSQL integration tests** passed. Typecheck and build passed. The real n8n
smoke retained five synthetic tickets: normal support (one attempt/one message),
pre-commit failure and lost response (two attempts/one message each), false
success (failed verification/zero messages), and unavailable verification
(unknown, then verified via reconciliation/one message). No live model was called.

The subsequent [browser test suite](UI_TESTING.md) now exercises real journeys,
keyboard interactions, accessibility and 1440/1024/390/320px layouts, with screenshot
evidence. Its [audit](../experiments/ui-e2e-audit.md) preserves the original failures
and their repaired, passing results, including Firefox. The
[release-signoff checklist](RELEASE_SIGNOFF.md) separates those automated results
from human-effort observations, screen-reader review and remote CI evidence.
This is not a full plan-completion signoff.
