# Release signoff: evidence, not assumptions

Use only synthetic customer data. Implementation evidence is tracked in
[implementation status](../IMPLEMENTATION_STATUS.md).

## Human-effort observations

The measurement UI is implemented and tested. No genuine human observations have
been supplied yet. Until then, removed human work remains **not established**.

1. Declare the cohort before measuring: scenario IDs, fixture/live mode, policy
   version, start/cutoff, operator and sample count. Include failed/escalated work.
2. Time active reading, investigation, review, follow-up and recovery. Exclude
   unattended execution and queue waits. Review minutes are a subset of total
   minutes. Browser dwell time and AI execution time are not human labor.
3. In ticket detail → **Record effort**, choose **Operator-reported measurement**,
   enter cumulative totals and the measurement method. Assert completeness only
   when all work is included; new work requires a new snapshot.
4. A measured manual baseline must use the same scenario and verified destination
   outcome, with the same scope of work. Record its method/version. If a comparable
   manual workflow is unavailable, leave the baseline absent. Do not compare a
   drafted reply with independently verified delivery.
5. Run `pnpm report:outcomes`. Review coverage, matched sample counts, negative
   savings, unresolved work and source/mode separation. Synthetic baselines remain
   estimates. A tiny convenience sample cannot establish general productivity.

Record operator/pseudonym, date, cohort, ticket IDs, timing method, baseline
reference or N/A, cutoff and limitations. Never include credentials or private
customer data. The application audit trail stores the observations.

## Human accessibility and visual review

Record tester, OS, browser/version, assistive technology/version, commit and
viewport. Mark each item PASS, FAIL (with reproduction), or NOT TESTED.

- Navigate landmarks/headings and mobile navigation with the screen reader.
  Names, order, current page and fixture/live mode must be understandable.
- Connect with the local operator token. Check that it is a password field and
  the token is not exposed in error messages.
- Create an invoice ticket using only the keyboard. Verify required-field and
  confirmation behavior, creation feedback and the resulting response.
- Review a refund. Read customer, invoice, payment, amount, expiry and proposal
  before deciding. Approval must remain distinct from verified execution.
- Check dialog focus, background exclusion, Escape and return focus. Read expanded
  evidence while polling is active; reading/focus must not unexpectedly reset.
- Exercise a failed write, unknown outcome and reconciliation. Errors must be
  understandable, input recoverable and status changes perceivable.
- Inspect 1440, 1024, 390 and 320px widths, zoom/reflow, focus, scrolling and modal
  actions. Check populated content as well as empty screens.
- Read Outcomes: N/A and synthetic assumptions must not sound like measured savings.

`keyboard.spec.ts` automates keyboard-only journeys; axe checks semantics/contrast.
Neither proves speech output, screen-reader usability or human visual acceptance.
Do not mark human signoff complete from those tests alone.

## Remote publication and CI

On 2026-09-24 the maintainer subsequently authorized pushing the implementation
branch and checking remote CI, superseding the earlier local-only instruction.
The repository remains private. No merge, release, visibility change or tag push
is part of that authorization.

The first remote run [35992480469](https://github.com/dharmendrathinks/ai-automation-lab/actions/runs/35992480469)
passed at commit `38f3194df2562e92617b7c485d5ac1dffd9f936a` on native Ubuntu ARM64,
Node 24.21.0: 59 unit/process/DOM/harness tests, 35 PostgreSQL tests, 136 browser
tests, build and both type checks. This is historical evidence, not proof for
later commits. Check the [branch workflow history](https://github.com/dharmendrathinks/ai-automation-lab/actions/workflows/ui-e2e.yml)
against the exact proposed commit before merging. The hardening pass adds lint
to CI and updates immutable action pins to Node-24-based releases.

A local rehearsal is not a GitHub Actions run. Native ARM64 is the supported
platform in `PLAN.md`; x86 compatibility is not claimed and emulation is not a
release requirement.
