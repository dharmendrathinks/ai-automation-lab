# Follow-up release hardening — 2026-09-24

Scope: lint/CI maintenance, targeted adversarial checks, UI edge states and
evidence documentation. This is a bounded review of the local synthetic lab,
not a penetration test or production-security certification. No model calls,
new infrastructure, database migrations or n8n workflow changes were required.

## Reproduced defects and fixes

| Boundary | Observed before-state | Fix and regression evidence |
| --- | --- | --- |
| Credential configuration | Short or identical operator/automation tokens were accepted. Identical tokens erase the intended role boundary. | Reject configured automation tokens under 32 characters or equal to the operator token. Route tests also confirm automation cannot access operator reads/writes. |
| Scenario intake | Unlike normal intake, scenario requests accepted malformed references and blank messages; oversized messages reached a database error. | Reuse the existing ticket contract. Five invalid-input cases return 400 without ticket/run/audit/outbox writes. |
| Verification order | Reading a ready support action before execution marked it failed and prevented execution. The same race existed between a pre-commit failure and its retry. | Under the existing action lock, require a destination receipt or an attempt that could have produced an outcome. Otherwise return 409 without changing state. False success still fails verification; committed response loss and unknown reconciliation retain their existing semantics. |
| Destination binding | Matching response text on a different ticket could verify the original ticket. | Verify ticket identity and automation authorship as well as text/visibility. A deliberately corrupted synthetic destination remains failed/open. This test does not imply an unauthenticated database-write exploit. |
| Connection cancellation | A late readiness response could reconnect after Escape and close a new dialog. | Keep candidate credentials local to the request; apply results only to the still-open originating form. |
| Loading/disconnect | Aborting a load left the disconnected workspace marked `aria-busy`. | Clear busy state and ignore late private reads. |
| Skip navigation | The skip link changed the hash and routed Tickets back to Overview. | Focus main without changing the current route; verify keyboard activation. |
| Late writes | Closing a submitted form and opening a new draft allowed the first response to close the replacement. | Preserve the new dialog and route; show a refresh/inspection notice. Closing a dialog is not cancellation of a server-side write. |
| Narrow-screen content | A 64-character unresolved customer reference overflowed the conversation header at 320px. | Allow the flex text column to shrink and wrap while preserving the avatar; exercise queue, conversation and run evidence with maximum-length input. |
| Pointer-opened dialog focus | WebKit did not focus a clicked opener, so Escape restored focus to the previous page element. | Explicitly focus dialog triggers before opening; keep the same return-focus assertion in every browser. |

The initial database regression run reproduced nine failing cases. A subsequent
case reproduced the verification-between-retries race. Four DOM regressions
reproduced the cancellation, busy-state, skip-link and late-write defects before
their fixes. The existing approval-tampering protections passed: extra reviewer,
hash, action and amount fields are rejected; approvals remain pending and no
refund is created. Existing concurrent-review/refund, receipt conflict, expiry,
retry-budget and Wait/restart tests remain enabled.

The provider descendant-cleanup test exposed a 500ms cold-start assumption under
parallel load. Its synthetic child now writes readiness only after registering
its SIGTERM handler, and the test allows two seconds for startup. It still
requires timeout rejection and a dead descendant; production timeouts, kill
behavior and test retry policy are unchanged.

## Tooling

Pinned Oxlint 1.85.0 checks correctness, unused bindings and debugger statements,
with warnings fatal. Application and E2E TypeScript checks remain separate. The
one narrow lint suppression documents Playwright's required destructured fixture
signature; generated artifacts are excluded, not test source. No production
dependency was added.

GitHub Actions checkout 7.0.1, setup-node 7.0.0 and upload-artifact 7.0.1 use
immutable SHA pins and Node 24 action runtimes. Read-only repository permissions,
disabled checkout credential persistence, fixture-only execution, native ARM64
and seven-day synthetic-artifact retention remain unchanged. Setup-node's
implicit package-manager caching is disabled; the locked install stays explicit.

## Reproduce and limitations

```sh
pnpm install --frozen-lockfile
pnpm test:baseline
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e:all
```

The baseline passes **63 unit/process/DOM/harness tests and 46 isolated
PostgreSQL tests**, plus lint, both type checks and build. Browser coverage now
contains **152 cases** (38 per project), adding real delayed-read/cancellation
checks and 8,000-character content at 320px. Empty primary screens also receive
320px overflow checks. The first long-content test incorrectly requested a
Refresh control absent from ticket detail; the test was corrected, not the UI.

See [release signoff](../guides/RELEASE_SIGNOFF.md) for the first successful remote
run and the branch workflow history. Match remote results to the exact candidate
commit; do not treat the historical 136-test run as validation of newer changes.

Human productivity remains unproven without matched actual effort observations.
Automated axe/keyboard checks and screenshot inspection are not human
screen-reader signoff. Public deployment, production RBAC, real billing/support
integrations, physical-device and x86 support are not established by this pass.
Fixture mode remains default; cost/effort without evidence remain N/A. Publishing
the branch did not make the private repository public or publish a release.
