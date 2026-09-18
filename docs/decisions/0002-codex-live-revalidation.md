# 0002 — Revalidate the isolated Codex runtime for Milestone 6

Date: 2026-09-18

Status: **IN PROGRESS — backend live path validated; n8n end-to-end pending**

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
and rejection of tool activity. Docker/n8n is not installed on the current host,
so the provider-neutral workflow has not yet been exercised end to end in live
mode. Do not mark or tag Milestone 6 complete until that criterion and the final
provider isolation tests pass.

