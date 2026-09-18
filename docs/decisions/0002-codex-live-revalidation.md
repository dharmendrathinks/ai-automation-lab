# 0002 — Revalidate the isolated Codex runtime for Milestone 6

Date: 2026-09-18

Status: **GO — bounded live runtime approved for explicit local opt-in**

Milestone 6 supplied the concrete integration need allowed by decision 0001. The
dedicated `.local/codex-runtime` was authenticated through the official ChatGPT
login flow without copying developer credentials or supplying an API key.

The installed CLI had advanced from 0.154.0 to 0.155.0. The exact probe pin was
updated. Its first run stopped before inference because 0.155.0 rejects the old
`tools.view_image` configuration key under strict configuration. Removing only
that obsolete key produced a successful schema-constrained call using
`gpt-5.6-terra`. The remaining explicit tool, app, agent, hook, web-search and
project-instruction restrictions stayed in place.

The production adapter uses an absolute executable, isolated `CODEX_HOME`, fresh
working directory, ephemeral session, read-only sandbox, no approvals, bounded
input/output and a 180-second deadline. Any tool event is a security failure.
Live mode is explicit; fixture mode remains the default and there is no paid API
fallback.

The 20-case and 100-call live evaluations are recorded in
[live AI evaluation](../experiments/live-ai-evaluation.md). They establish model
access, repeated non-interactive execution, structured output, usage reporting
and rejection of tool activity. A hostile synthetic ticket could not disclose or
alter a random canary, create a marker file, or trigger an observed tool event.
Fake-process tests cover timeout, cancellation, descendant cleanup, malformed
output, authentication, quota, rate-limit and unavailable-provider failures.

Using Colima, the same imported n8n workflow passed in fixture and live modes.
The live support path recorded policy, posted the canonical response, read it
back independently and marked the ticket resolved with a verified action. The
runtime is therefore approved behind explicit `LAB_AI_MODE=live`; fixture mode
remains the default.
