# Browser tests without a private setup

The UI suite uses **real browsers, the actual RelayDesk backend, PostgreSQL, and
the checked-in n8n workflows**. Successful journeys do not mock business APIs,
call a model, or bypass approval by inserting a resolved ticket.

The original product failures have been repaired; see the before/after
[dated browser audit](../experiments/ui-e2e-audit.md). A nonzero exit is a regression
to investigate, not an expected result. Do not mistake passing unit tests for a
green UI release gate.

## First run

Requirements: the Node/pnpm versions in the repository, a running Docker engine
with Compose v2+, and approximately 4 GB free memory for the disposable stack.
The existing service images are pinned to ARM64. Native ARM64 is the validated
path; x86 hosts are not a supported/tested target for this release. The plan
explicitly avoids forced emulation. The CI job
uses `ubuntu-24.04-arm` to match these pins.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:e2e
```

On Linux, use `pnpm exec playwright install --with-deps chromium` to install the
browser's system libraries. Initial setup downloads dependencies and takes longer
than a warm run. There is **no `.env`, model login, API key, n8n owner account,
manual workflow import, or running development server required**.

The test runner creates a uniquely named Compose project with separate databases,
volumes, and a dynamically assigned loopback port. It migrates and seeds that
database, imports the reviewed workflows, runs the browser tests, then removes
only its own containers/volumes. An existing RelayDesk stack can stay running.
Each test gets a fresh browser context and a clean synthetic business baseline.

## Useful commands

```sh
# One journey while developing
pnpm test:e2e --grep 'invoice ticket'

# See Chromium while tests execute
pnpm test:e2e:headed

# Cross-engine and mobile coverage
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e:all

# Type-check the test harness and specs
pnpm test:e2e:typecheck

# Unit/type/build and isolated PostgreSQL regression checks (no .env required)
pnpm test:baseline

# Inspect screenshots and failure traces
pnpm test:e2e:report
```

Tests use retrying assertions and observed states. The native restart exercise
uses explicit bounded callback backoff (one, two, then three seconds), matching
its persisted retry budget; it does not mask a failed assertion with a delay. Test
retries are disabled so intermittent failures stay visible. One worker owns the
resettable test database; do not override `--workers` without adding genuine
worker-level database isolation. `--repeat-each=2` is useful for repeatability.

## Coverage and evidence

| Contract              | Observable checks                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Invoice support       | UI intake → real n8n → exactly one canonical destination message/receipt → verified ticket and run UI           |
| Pending orchestration | Paused worker leaves the ticket open, without a provider call or fabricated resolution                          |
| Refund approval       | No pre-approval refund; explicit exact-amount review; billing totals and one refund verified independently      |
| Rejection/expiry      | No unauthorized money movement, auditable rejection, server rejects stale open review                           |
| Safe escalation       | Account mismatch/unknown customer escalates; ambiguous request awaits clarification without executing an action |
| Failure/retry         | Persisted failed attempt, successful retry, exactly one destination mutation                                    |
| Lost response         | Same logical action replays with one receipt and no duplicate destination message                               |
| False success         | Successful simulated API response does not hide failed destination verification                                 |
| Unknown outcome       | Unknown stays visible; UI reconciliation verifies without another execution                                     |
| Economics             | Human-approved completion is not fully automated; fixture/live cohorts separate; absent effort/cost remain N/A  |
| Effort entry          | Real form validates total/review minutes; synthetic snapshots remain separate from operator-reported labor     |
| Native Wait recovery  | Real waiting execution survives n8n restart; approval/callback races and duplicate replay remain safe         |
| Session/security      | Invalid token, logout/reload, no stored credentials, escaped hostile text, restrictive CSP, private API auth    |
| Interaction           | Native validation, search/filters, empty/error views, deep links, retained input after write failure            |
| Keyboard journeys     | Connect, create invoice/refund, inspect and approve using keys only; independently verify destination records |
| Accessibility/layout  | Axe WCAG A/AA checks, keyboard dialog focus/Escape, 1440/1024/390px overflow checks, screenshot evidence        |

`journeys.spec.ts` tests business journeys. `workspace.spec.ts` tests interaction
and security boundaries. Only error-transport tests intercept responses; they
simulate a failure, not a successful business result. `accessibility.spec.ts`
checks semantics/layout and captures actual screenshots. Browser engines are
Chromium, Firefox, and WebKit, plus mobile Chromium emulation (not a real device).
There are 34 cases per project, 136 in the full matrix. `keyboard.spec.ts` uses
Tab/Shift-Tab, typing and activation keys without programmatic focus or clicks.
On macOS, WebKit uses Option-Tab to include all controls; Firefox's disposable
test profile enables all-control tab navigation. These tests do not change OS
preferences or establish screen-reader usability. `recovery.spec.ts` is an
API/database/orchestration test alongside the UI journeys; it does not pretend a
Wait exercise has a dedicated UI. Three workflows are imported. On macOS only,
Firefox gets a disposable app-data directory to avoid touching personal profiles.

The independent oracle reads SQL business records through a **test-only** server
entry point. UI mutation steps still use the real forms and production API routes.
The oracle never declares success on behalf of the application. The imported
workflow copies change only their API origin to the isolated Docker service;
the source workflow files, retries, nodes, and business logic are not rewritten.

## Safety and reproducibility

- The normal application server never imports test control routes. The test entry
  point refuses any database URL or instance identity except its disposable setup.
- Compose never reads your `.env` or mounts your home, `.local`, `.codex`, host
  `node_modules`, or entire repository. Runtime inference is `FixtureProvider`.
- Test tokens are public disposable values, not credentials for a developer's lab.
  Screenshots/traces may contain them and synthetic customer data. Never reuse
  them in a real deployment, and never point tests at a shared environment.
- The browser fails a test if the app contacts any origin outside its test server.
  The n8n editor link is not followed because it targets the normal development
  editor, not this disposable service.
- Backend and browser clocks start at the baseline fixture date so the refund
  eligibility window doesn't rot with calendar time. Expiry tests explicitly
  advance the test clock; they do not wait a day or weaken production policy.
- Reports and screenshots are ignored by Git. Failure traces are retained, but
  raw runtime output, developer credentials, and storage-state files must not be
  committed. CI publishes only synthetic test artifacts, retained for seven days.

## Debugging a failure

1. Read the failed assertion and open `pnpm test:e2e:report`.
2. Reproduce one spec or title with `--grep`, optionally `--headed`.
3. Distinguish a harness/setup failure from a real application defect. Do not
   relax business assertions, add a sleep, disable an axe rule, or manufacture a
   screenshot baseline just to turn a check green.
4. A failed product contract should stay visible until fixed. If a regression is
   deliberately recorded with `test.fail`, give it a concrete issue reference
   and keep asserting the desired behavior; an unexpected pass must fail the test.

Normal completion and setup failures clean up the generated project. A forced
process/host kill can leave its isolated resources behind. Locate the exact
`relaydesk-e2e-<pid>-<random>` project with `docker compose ls`; inspect its labels
before removing anything. Never use broad `docker system prune` or remove the
normal `relaydesk` project to clean up a test.

Automated accessibility checks and screenshots do not prove that a product is
beautiful or fully accessible. Review screenshots at the target sizes and perform
screen-reader/manual keyboard QA before release. A passing UI suite also does not
close unrelated provider/reliability/economics gates in `IMPLEMENTATION_STATUS.md`.

Patterns follow [Playwright's fixture guidance](https://playwright.dev/docs/test-fixtures)
and [accessibility testing guidance](https://playwright.dev/docs/accessibility-testing).
Runner architecture follows the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
