# 0001 — Freeze the Codex spike; continue with fixture mode

Date: 2026-09-13

Status: **FROZEN — NO-GO for enabling runtime Codex at this checkpoint**

## Question

Can a bounded, isolated Codex invocation serve as RelayDesk's initial reasoning
provider without inheriting developer tools or using separately billed API keys?

## Experiment and actual result

Implemented a minimal TypeScript process harness with a fixed synthetic ticket,
strict output validation, an explicit child environment, POSIX process-group
cancellation, a deadline and bounded output. It exposes no application endpoint.

The preflight was run with installed Codex CLI **0.154.0**:

```sh
LAB_CODEX_BIN=/absolute/path/to/codex pnpm spike:codex
```

Actual sanitized output (exit code 2):

```json
{
  "mode": "PREFLIGHT ONLY",
  "cliVersion": "0.154.0",
  "result": "NO_GO",
  "reason": "isolated_chatgpt_authentication_not_established",
  "modelCalls": 0,
  "runtimeEnabled": false
}
```

The existing developer Codex installation reports ChatGPT authentication. The
probe intentionally uses a separate `.local/codex-runtime` directory with
file-based credential storage. That directory has no authenticated session.
Developer credentials were not copied, and API keys were not supplied.

This is an unmet runtime setup/security gate, **not evidence that Codex cannot
classify tickets or that subscription-backed execution is unsupported**.

## Evidence and limits

- `pnpm test`: **17 tests passed** on Node 26.5.0, macOS ARM64.
- `pnpm typecheck` and `pnpm build`: passed.
- Process tests use a **fake executable**, not a model.
- Covered valid/invalid schema output, unexpected tool events, missing completion,
  output overflow, cancellation, timeout, spawn failure, sanitized provider-error
  mapping, and terminating a child process that ignores SIGTERM.
- Real CLI preflight confirmed the pinned version and stopped at authentication.
- No real structured model response, prompt-injection containment, model access,
  authentication refresh, quota recovery, token consumption or latency was tested.
- Disabling tools in configuration and rejecting tool events after they appear
  are **not independent proof** that a real Codex process cannot use those tools.
- The real invocation has not passed the full isolation acceptance gate.
- The configured candidate model is `gpt-5.6-terra`; it was not invoked or verified
  as available to this isolated runtime.

## Decision

Freeze this spike. Continue immediately with RelayDesk, PostgreSQL and n8n using
**FIXTURE MODE**. The harness remains under `spikes/`; it is not a production
provider, generalized framework or reason to delay business-system work.

Keep live inference disabled. There is no paid API fallback. No live accuracy or
model-behavior claim can be made from this result. Revisit only for a concrete
runtime integration need, security issue or regression, as required by the plan.

Milestone 0's deliverable is a tested feasibility assessment with an explicit
decision, not a successful live provider. Its no-go branch has been exercised.
No n8n workflow was applicable to this milestone. No video is warranted yet.

## References

- [Harness](../../spikes/codex-feasibility/runner.ts)
- [Probe](../../spikes/codex-feasibility/probe.ts)
- [Reproducible process tests](../../spikes/codex-feasibility/runner.test.ts)
- [Approved spike gate](../../PLAN.md#i-codex-integration-and-required-spike)
- [Official non-interactive Codex documentation](https://developers.openai.com/codex/noninteractive)
- [Official authentication documentation](https://developers.openai.com/codex/auth)
