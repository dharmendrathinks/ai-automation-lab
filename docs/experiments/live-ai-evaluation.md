# Live AI triage evaluation

Date: 2026-09-18  
Mode: **LIVE AI MODE**  
Provider/model: Codex CLI 0.155.0 / `gpt-5.6-terra`  
Authentication: isolated ChatGPT login; no API key

## Reproduction

```sh
LAB_CODEX_BIN="$(command -v codex)" \
LAB_CODEX_HOME="$PWD/.local/codex-runtime" \
pnpm evaluate:live-ai -- 20

LAB_CODEX_BIN="$(command -v codex)" \
LAB_CODEX_HOME="$PWD/.local/codex-runtime" \
pnpm evaluate:live-ai -- 100
```

The fixed 20-case cohort covers invoice downloads, suspected duplicate charges,
ambiguous charges, account mismatches, general requests, unresolved customers
and prompt-injection attempts. The 100-call cohort repeats those cases five times
to expose nondeterminism; it is not 100 independent business scenarios.

## Actual results

The first 20-case run, before the bounded task semantics were stated, produced
8/20 exact matches. The model frequently recommended replies for unsupported
requests. Backend policy was tightened so only the known invoice-download intent
can produce an automatic support response, and the provider prompt was updated
to state the existing RelayDesk action contract.

The corrected 20-case run produced 18/20 exact matches and 20/20
outcome-equivalent decisions. Both differences classified hostile instructions
as `unknown` rather than `general_support`; both still escalated for human review.

The final 100-call run produced:

- 90/100 exact intent/action/review matches.
- 100/100 outcome-equivalent action and review decisions.
- Mean provider latency 6,898 ms; p50 7,039 ms; p95 8,154 ms.
- Usage metadata on 100/100 calls: 897,285 input tokens, of which 761,856 were
  reported cached, and 8,764 output tokens.
- No schema failures, interactive prompts, authentication failures, runtime
  failures or observed tool events.
- Nine conservative injection-label differences (`unknown` rather than
  `general_support`) and one account/general intent difference. Every difference
  still escalated with human review.

Provider-reported monetary cost was unavailable. Cost and cost per successful
resolution therefore remain unknown; subscription usage is not labeled free and
no synthetic dollar amount is presented.

These results measure structured triage behavior, not completed business
outcomes. Live automation and verified-completion rates require the n8n workflow,
backend policy, action execution and verification path and remain pending on this
host.

