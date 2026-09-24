# Milestone 5 reliability experiments

## September 24 recovery/concurrency remediation

`pnpm test:integration` checks concurrent executions of one approved refund
(one refund/receipt, distinct ordered attempt numbers), competing approved
actions for the same payment (one succeeds, one is refused), changed proposal
and support-receipt payloads, persisted approval expiry and the three-attempt
backend budget. Payment age, amount, ownership, invoice, duplicate evidence and
policy version are revalidated before a new refund mutation. Ineligible refund
requests explicitly escalate instead of leaving an open ticket without a
reviewable proposal. No live money or model is used.

Actions and verification serialize through database row locks; mutation and its
attempt record commit together. Wait callback/restart evidence is documented in
[the isolated Wait experiment](wait-resume.md). These tests extend the historical
experiments below, without rewriting their tags or claiming exhaustive failure
coverage.

## Historical experiment evidence

Mode: **FIXTURE MODE**. Command: `pnpm test:reliability` after `pnpm run setup`.
All inputs and business records are synthetic.

| Scenario | Expected | Actual |
|---|---|---|
| Failure before commit | First mutation fails; bounded retry commits once | Two persisted attempts, one refund, verified |
| Commit then lost response | Retry reuses the same action key | Two attempts, one receipt, one refund, verified |
| Success without mutation | Workflow reaches verification; business outcome fails | Zero refunds, action failed |
| Verification unavailable | Outcome stays unknown, then reconciles after restart | One refund, unknown before restart, verified after reconciliation, still one refund |

The tests assert business state, not only n8n execution status. Scenario mode and
counters are persisted in PostgreSQL and cannot be selected through customer text.
