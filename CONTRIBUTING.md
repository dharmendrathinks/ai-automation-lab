# Contributing to AI Automation Lab

Thanks for taking the time to examine the engineering, not just the demo. The
most useful contributions are small, reproducible changes with evidence of what
they improve.

## Start with a real UI journey

No model account or private credentials are needed:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:e2e --grep 'invoice ticket'
```

Docker with Compose is required. The pinned services use ARM64; see the
[browser testing guide](docs/guides/UI_TESTING.md) for supported setup, cross-browser
commands, screenshots, isolation, and troubleshooting. For fast feedback without
Docker, run `pnpm test` and `pnpm typecheck`.

## Add a regression test

1. Choose the nearest spec under `tests/e2e/`: business journeys, workspace
   interactions, or accessibility/layout.
2. Use the shared isolated fixtures. Create requests and make reviewer decisions
   through the UI; do not seed a successful result and call it end-to-end coverage.
3. Prefer accessible roles/labels and retrying assertions over CSS implementation
   details, arbitrary sleeps, or oversized page-object abstractions.
4. Check both what a person sees and what was actually persisted. A workflow's
   success status alone does not establish a useful business outcome.
5. Keep fixtures synthetic and tests order-independent. Never load `.env`, reuse
   your running API, call a live provider, or add real credentials to traces.
6. Reproduce the failure, make the smallest appropriate change, and run the
   relevant test plus type checks. Disclose which browsers you actually ran.

## Pull request checklist

- [ ] Explain the problem and expected/observed behavior; include reproduction.
- [ ] Follow `PLAN.md`, `AGENTS.md`, and `docs/REPOSITORY_WORKFLOW.md` boundaries.
- [ ] Relevant tests pass: `pnpm test`, `pnpm typecheck`, `pnpm test:e2e:typecheck`,
      `pnpm build`, and the browser journeys affected by the change.
- [ ] Check keyboard, narrow screens, empty/loading/error states for UI changes.
- [ ] Keep fixtures and live-AI results distinct; no invented savings or outcomes.
- [ ] Review screenshots/traces before sharing; do not commit generated artifacts.
- [ ] Update the appropriate guide and describe known limitations honestly.

Please report UI bugs with the browser/OS, viewport, fixture scenario, exact steps,
and observed versus expected result. Never attach `.env`, provider credentials,
private customer data, or unsanitized logs. Check the current implementation
status before assuming a planned capability already exists.

Our original code is MIT-licensed. n8n and model services have their own licenses
and terms. This is a local synthetic teaching lab, not a production deployment.
