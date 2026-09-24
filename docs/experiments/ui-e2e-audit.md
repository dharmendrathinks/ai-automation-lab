# Browser contract audit — 2026-09-24

Status: **original browser blockers repaired**. The initial test-only audit below
is preserved as before-state evidence. The subsequent remediation changes product
code and does not, by itself, establish full-plan completion.

## Remediation

- Empty reconciliation POSTs no longer advertise a JSON body they do not send.
- Customer-reference patterns escape the hyphen under modern HTML validation.
- Muted text now meets the automated AA contrast checks on tested backgrounds.
- macOS Firefox receives its own disposable `MOZ_APP_DATA` directory; personal
  profiles and permissions are untouched. The independent launch and original
  **120-test matrix passed** after this fix (30 per project, no skips/retries).
- Added effort-entry provenance/negative-savings checks and a real persisted n8n
  restart/callback exercise: the expanded suite has **128 tests**, 32 per project.

Expanded run: **128 passed in 5.9 minutes**, no skips or test retries: Chromium
32/32, Firefox 32/32, WebKit 32/32, mobile Chromium 32/32. This includes the real
n8n restart exercise in every project. The disposable stack was removed and the
existing lab left untouched. The accompanying 58 unit/DOM/process/corpus tests,
35 isolated PostgreSQL tests, build and both type checks pass.

The Firefox fix follows the observed macOS direct-execution failure discussed in
[Mozilla issue 2069536](https://bugzilla.mozilla.org/show_bug.cgi?id=2069536).
Current full-plan limitations are tracked in
[implementation status](../IMPLEMENTATION_STATUS.md). Remote CI and physical
devices remain unvalidated; automated axe checks are not screen-reader signoff.

## Reproduce

Follow [UI testing setup](../guides/UI_TESTING.md), then run:

```sh
pnpm test:e2e
pnpm test:e2e:report
```

There are 30 scenarios per browser project: 14 business journeys, 8 workspace
interaction/security checks, and 8 accessibility/layout checks. The actual
backend, PostgreSQL and imported n8n workflows run in a disposable stack.
All data is synthetic and all inference uses `FixtureProvider`; no live model
account, real money, or developer credentials are involved.

## Initial observed results (before remediation)

Local macOS ARM64, Playwright 1.63.0, axe-core integration 4.13.0:

| Project                             | Passed | Failed | Interpretation                                       |
| ----------------------------------- | -----: | -----: | ---------------------------------------------------- |
| Chromium                            |     20 |     10 | Eight contrast checks and two functional regressions |
| WebKit                              |     20 |     10 | Same defect categories                               |
| Mobile Chromium (390×844 emulation) |     20 |     10 | Same defect categories; not physical-device testing  |
| Firefox                             |      0 |     30 | Browser launch failed before application assertions  |

Firefox reports `Could not find profile folder.` from the installed Playwright
browser. An independent minimal launch also failed with both the default
temporary directory and `/tmp`. No Firefox application coverage is claimed;
the project remains enabled in CI. The GitHub Actions workflow has not been
executed remotely. x86/emulated Docker has not been validated.

The 40 unit/DOM/harness tests, application build, application type check and
separate E2E type check pass. Disposable containers and volumes were removed
after the run; the existing development stack was left running.

## Product defects exposed

### 1. Unknown-outcome reconciliation returns HTTP 400

Reproduction: connect → Reliability lab → **When the answer is unknown** →
configure and run → **Reconcile outcome**.

Expected: the existing committed destination operation is verified; the ticket
resolves without another execution or duplicate message.

Observed: the actual browser POST has `Content-Type: application/json` and an
empty body. The API returns `400` with `invalid_request`; the outcome remains
unknown. The UI API helper adds that header, while this call supplies no body.
The regression asserts HTTP 200, a verified SQL outcome and exactly one attempt
and message. API-only reconciliation with an explicit `{}` body did not expose
this UI integration defect.

### 2. Customer-reference pattern does not reject invalid characters

Reproduction: New ticket → enter a reference containing spaces or `/`.

Expected: native input validation reports `patternMismatch` before submission.
Observed: it reports `false`. The shipped pattern is `[A-Za-z0-9_-]{1,64}`;
the hyphen is not escaped for modern
[HTML pattern validation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/pattern#overview). The browser test
records actual validity instead of assuming a `pattern` attribute is effective.
Backend validation still exists; this is not evidence of an authorization bypass.

### 3. Text contrast fails WCAG AA

Axe reports serious `color-contrast` violations across workspace screens and
dialogs. Examples from the overview: the inactive live-results control is
**4.32:1**, and the feature-panel eyebrow is **4.42:1**, below the required
**4.5:1** for that text. Inactive queue filters and token-help code text also fail.

Each failure attaches node selectors and measured colors/ratios. Soft assertions
continue collecting viewport screenshots and interaction evidence, but still
fail the test. No accessibility rule is disabled and no failure is marked skipped
or expected. The native-dialog keyboard check permits focus in browser chrome
but rejects focus in background page controls.

## What the passing journeys establish

- Real UI intake yields one verified support response and one destination receipt.
- Approval is required before an exact-amount refund; rejection and stale review
  cannot move money. Reviewer reasons and history are visible and persisted.
- Safe escalation/clarification creates no executable action.
- Failed-before-write retries and lost-response replay do not duplicate effects.
- A simulated successful response without a destination write stays failed.
- Fixture/live outcome cohorts stay separate; approved work is not fully
  automated, and missing effort evidence is not fabricated.
- Session boundaries, hostile-text escaping, failure recovery views, filters,
  deep links and CSP/auth contracts pass in the three functioning projects.

Screenshots cover 1440, 1024 and 390px plus populated conversations, run evidence
and approval dialogs. These are review artifacts, not approved pixel-diff
baselines. Automated checks do not replace screen-reader or visual review.

## Initial release decision (superseded for the repaired browser defects)

Keep these regressions failing until the product is fixed, then rerun the full
matrix and investigate Firefox independently. Do not advertise a green browser
suite or full open-source release readiness. The broader unresolved gates in
[implementation status](../IMPLEMENTATION_STATUS.md) still apply.
