# Dharmendra Thinks video checkpoints

Engineering/content handoff for [AI Automation Lab](../PLAN.md). Follow the [repository workflow and evidence rules](REPOSITORY_WORKFLOW.md).

Two deterministic reliability experiments are now reproducible. They demonstrate
real application and n8n behavior in **FIXTURE MODE**, not live model behavior.

## Controlled live automation evaluation

```text
Experiment/question: Can a live model classify requests while backend policy and verification retain control?
Status: READY
Mode: LIVE AI MODE
Start tag: not created
End tag: video-live-ai-evaluation-end
Engineering milestone: 6
Demo scenario: 20-case then 100-call triage evaluation plus verified invoice response
Command/setup: pnpm evaluate:live-ai -- 20; pnpm evaluate:live-ai -- 100; pnpm test:live-support
Expected observable result: schema-valid decisions, safe escalation, no tool activity, verified supported outcome
Actual observed result: 90/100 exact matches, 100/100 outcome-equivalent routing, one live verified resolution
Tests/evidence: docs/experiments/live-ai-evaluation.md; scripts/evaluate-live-ai.ts
Important limitation: repeated 20-case cohort, one end-to-end resolved ticket, provider monetary cost unavailable
Possible video angle: Optimize for verified useful outcomes, not maximum automation or exact model labels.
```

## False success

```text
Experiment/question: What if an API reports success but the business mutation never occurred?
Status: READY
Mode: FIXTURE MODE
Start tag: video-false-success-start
End tag: video-false-success-end
Engineering milestone: 5
Demo scenario: false-success
Command/setup: pnpm run setup; pnpm test:reliability
Expected observable result: action call succeeds, no refund exists, verification fails
Actual observed result: zero refunds; action and business outcome recorded failed
Tests/evidence: docs/experiments/reliability-lab.md; scripts/test-reliability.ts
Important limitation: deterministic injected billing behavior, not a real provider failure
Possible video angle: Workflow success is not business success; verify the destination state.
```

## Lost response and idempotency

```text
Experiment/question: What if a refund commits and its response is lost before the workflow receives it?
Status: READY
Mode: FIXTURE MODE
Start tag: video-lost-response-start
End tag: video-lost-response-end
Engineering milestone: 5
Demo scenario: commit-lost-response
Command/setup: pnpm run setup; pnpm test:reliability
Expected observable result: retry reuses one key and exactly one refund exists
Actual observed result: two attempts, one receipt, one refund, verified
Tests/evidence: docs/experiments/reliability-lab.md; scripts/test-reliability.ts
Important limitation: deterministic transport failure against the synthetic billing API
Possible video angle: A lost response is an unknown outcome, not permission to repeat a financial action.
```

Prospective questions and qualification criteria are listed in the workflow guide. Add entries here only when a genuine experiment is being built. A completed engineering milestone does not automatically warrant a video.

## Entry template

Copy this template only for a real candidate. Replace placeholders with observed facts and reproduction details; do not present expected results as evidence.

```text
Experiment/question:
Status: IN PROGRESS | READY | DEFERRED
Mode: FIXTURE MODE | LIVE AI MODE
Start tag:
End tag:
Engineering milestone:
Demo scenario:
Command/setup:
Expected observable result:
Actual observed result:
Tests/evidence:
Important limitation:
Possible video angle:
```

Use `not created` for a tag that does not exist. Mark any intended tag name as planned. Set `READY` only after validation, evidence capture and creation of the end tag.

Link to concise, sanitized evidence and existing fixtures/tests rather than pasting large logs. Record live provider/model/version details when applicable. No scripts, titles or thumbnails belong in this file.
