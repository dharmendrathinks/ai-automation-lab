# Milestone 5 reliability experiments

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
