# Repository workflow and video evidence

This guide supplements the approved [AI Automation Lab plan](../PLAN.md). Follow it while implementing the existing engineering milestones.

Maintaining useful material for future **Dharmendra Thinks** videos is a **secondary objective**. Correct engineering remains primary. Do not distort the architecture, add unnecessary features or split work artificially to manufacture YouTube episodes.

The repository should preserve the genuine engineering story:

**problem → implementation → failure/experiment → evidence → improved system**

Extract eventual content from that history. Do not manipulate implementation to produce content.

## Preserve the engineering roadmap

Follow the approved milestones without redesigning their structure for content creation. Each completed milestone must include:

- Runnable code.
- Passing relevant tests and satisfied acceptance criteria.
- Updated documentation.
- Reproducible fixtures/scenarios.
- Normalized, reviewed n8n workflow definitions where applicable.
- A clear Git checkpoint.

The one-time Codex spike remains timeboxed as specified in the plan: spike once, record the result, freeze it and build RelayDesk plus n8n. A possible video never justifies extending that spike. A documented no-go can complete milestone 0 only when its feasibility-assessment acceptance criteria and relevant harness tests are satisfied; it does not mean live Codex is ready.

## Small, meaningful commits

A commit should normally represent one understandable engineering change. Commit incrementally rather than collecting an entire milestone into a giant commit such as `implement milestone 4`.

Examples:

```text
feat: add structured triage decision contract
feat: persist automation run state
feat: add duplicate-charge policy
feat: add n8n triage workflow
test: add ambiguous ticket fixtures
test: cover duplicate event delivery
fix: reject malformed AI decisions
docs: document triage workflow
```

Do not mix unrelated refactors, features and documentation unless necessary. Keep tightly related code, tests, contracts and workflow changes together when they form one coherent change. Do not split commits artificially for episode pacing.

## Annotated local milestone tags

Create an annotated local Git tag only after the milestone is genuinely complete and its acceptance criteria pass.

Use this fixed mapping to the existing roadmap:

| Engineering milestone | Tag |
|---|---|
| 0. One-time Codex gate | `milestone-0-feasibility` |
| 1. RelayDesk foundation | `milestone-1-business-foundation` |
| 2. First orchestration | `milestone-2-first-orchestration` |
| 3. Verified support response | `milestone-3-verified-response` |
| 4. Approved refund | `milestone-4-approved-refund` |
| 5. Reliability lab | `milestone-5-reliability-lab` |
| 6. Wire in live AI and evaluate automation | `milestone-6-live-ai` |
| 7. Teaching release | `milestone-7-teaching-release` |
| 8. Wait/resume exercise | `milestone-8-wait-resume` |

The annotation should summarize the completed engineering scope, validation result and any material limitation, with a reference to the relevant documentation/evidence.

- Tag the committed, tested state, not uncommitted work.
- Do not tag an incomplete or partially working milestone.
- Do not imply milestone 6 is complete if only fixture mode works.
- Do not move, replace or rewrite history behind an existing milestone tag. Fixes follow as new commits.
- Do not push tags or remotes unless the normal repository workflow explicitly requires it.

This guide records future implementation behavior. Creating these documents alone does not complete a milestone or justify creating tags.

## Video candidates are separate from milestones

Not every engineering milestone deserves a video. Prefer **3–4 strong engineering videos** to **8 weak milestone updates**.

A candidate qualifies only when it has:

- A clear technical question.
- A real experiment, with some uncertainty before running it.
- Observable evidence.
- A meaningful result or failure.
- A lesson transferable beyond this repository.

If these conditions are absent, complete the milestone without designating a video. The following are prospective candidates, not confirmed checkpoints or promises of episodes.

### Candidate A — Controlled AI automation

**Question:** Can an LLM understand a customer request while deterministic workflow rules remain in control?

This becomes viable only when the live `AIProvider` path and a meaningful workflow work together. Preserve the actual model decision, policy result, authorization boundary, action and outcome.

An early `FixtureProvider` milestone is not a live-AI experiment.

### Candidate B — False success

**Question:** What if the workflow reports success but the actual business outcome never happened?

Required observable demonstration:

```text
API response       SUCCESS
workflow           SUCCESS
verification       FAILED
business outcome   FAILED
```

Preserve evidence showing the n8n execution succeeded, mock billing returned success, the persisted refund was absent, verification failed and the business outcome failed. This can be a deterministic reliability experiment; label its provider mode accurately.

### Candidate C — Lost response and idempotency

**Question:** What if the refund succeeds but the response is lost and the automation retries?

Required observable demonstration:

```text
first action commits
response is lost
workflow retries
same idempotency key reused
exactly one refund exists
verification succeeds
```

Preserve the request/attempt correlation, reused key and actual persisted refund count, not merely a success message.

### Candidate D — AI evaluation

**Question:** Can we systematically test an AI business automation rather than judging a few demos?

Required evidence:

- Actual live-model evaluation on synthetic held-out tickets.
- Measurable structured decisions.
- Observed model mistakes, when present.
- Unsafe recommendations blocked by policy, when observed.
- Escalation behavior.
- Limitations, including sample size and nondeterminism.

Do not manufacture mistakes or unsafe recommendations to fill a narrative. If an expected behavior was not observed, record that absence honestly and qualify or defer the proposed angle.

### Optional candidate — Codex as runtime provider

Consider this only if the original feasibility spike produces a technically interesting result. Do not reopen or extend the spike to obtain one. Do not imply that an isolated Codex harness is already a complete SaaS automation.

## Preserve experiment start and end states

When a qualifying experiment is actually being built, create local annotated tags with a consistent experiment slug, for example:

```text
video-false-success-start
video-false-success-end
```

- The start tag identifies the clean, committed state immediately before implementing the central experiment.
- The end tag identifies the tested, reproducible finished experiment, including its documentation and evidence.
- Do not create video tags months in advance or for speculative candidates.
- Do not invent an earlier start state or rewrite history to make the story cleaner.
- Do not move or replace existing video tags; later improvements are new commits.
- Keep tags local unless the normal repository workflow explicitly requires a push.

The start state need not already demonstrate the experiment; it must have a reproducible baseline. The end state must demonstrate the recorded outcome. Record planned end-tag names as planned until the tag actually exists.

## Lightweight checkpoint record

Maintain [VIDEO_CHECKPOINTS.md](VIDEO_CHECKPOINTS.md) only when a genuine candidate emerges. Keep it concise; prospective ideas belong in this guide, not as fabricated progress records.

Use these fields for each actual candidate:

```text
Experiment/question:
Status:
Mode: FIXTURE MODE or LIVE AI MODE
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

Suggested statuses are `IN PROGRESS`, `READY` and `DEFERRED`. `READY` means the experiment is tested, evidence is recorded and its end tag exists. A meaningful failed hypothesis can be ready if the failure is real, reproducible and explained; an accidentally broken implementation is not automatically ready.

Do not write scripts, titles or thumbnails during normal implementation. The possible angle should be a short engineering lesson, not finished marketing copy. This document is an engineering/content handoff record.

## Reproducibility and evidence

For each confirmed experiment, preserve what a developer checking out its tags needs:

- Fixture/scenario ID and deterministic seed data.
- Exact command, setup steps and relevant environment requirements.
- Matching normalized workflow JSON and node/runtime versions.
- Failure-injection configuration.
- Expected database/business and dashboard states.
- Actual test/evaluation results and observed business state.
- Provider, model, CLI/adapter and prompt/schema versions when live AI was used.

Link the checkpoint to the relevant existing fixture, test, decision record or compact evidence artifact. Create a small experiment record under `docs/experiments/` only when needed; do not build a content-management system.

Separate **expected** results from **actual observed** results. Preserve evidence from actual runs, including failures. Never manufacture or hard-code evidence to make a demo succeed.

For deterministic scenarios, the command should reproduce the specified state. For live AI, preserve the original result and the exact rerun procedure while disclosing that model output, availability and limits can change. Do not claim that a rerun must reproduce the exact same live decision.

Evidence should remain useful after n8n execution-history pruning. Store compact, sanitized outputs or summaries supported by durable application audit records rather than relying solely on transient UI screenshots or an execution ID.

## Distinguish fixture and live-AI behavior

Label documentation, checkpoint records and demo setup clearly:

```text
FIXTURE MODE
LIVE AI MODE
```

`FixtureProvider` supports deterministic tests. `CodexProvider` or another actual model supports live AI behavior and evaluation. Never describe a fixture response as a model decision, or count fixture-based metrics as live-model accuracy.

The choice of a deterministic failure scenario does not require live inference. Describe precisely which part was simulated and which behavior the system actually exercised.

## n8n workflow history

When workflow behavior changes:

1. Modify and test using the supported development path.
2. Validate.
3. Export and sanitize.
4. Review the JSON diff.
5. Commit the workflow definition alongside the relevant application changes.

A developer checking out a milestone or video tag must receive the matching workflow version and its setup requirements. Do not rely on the current state of a developer’s n8n instance.

## Record technically interesting failures

Do not erase a failed assumption merely because the final implementation works. Where useful, add a concise decision or experiment note describing:

- Assumption.
- Experiment.
- Actual result.
- Why it failed, or what remains unknown if the cause is not established.
- Resulting engineering decision.

Use the existing `docs/decisions/` area or an experiment record. Preserve meaningful learning, not every typo, transient mistake or debugging log.

## Protect repository quality

Do not:

- Add fake complexity, unnecessary features or technologies for demonstrations.
- Weaken tests or hard-code outcomes to make demos succeed.
- Alter architecture for thumbnails or titles.
- Create huge commits or artificially split coherent engineering changes.
- Rewrite tagged history.
- Expose credentials or private data in artifacts.
- Commit private model credentials.
- Commit raw private reasoning or model internals.
- Claim stronger results than the evidence supports.

Synthetic input does not make all runtime output safe to publish: inspect logs, workflow exports and evaluation artifacts for credentials, local paths and unrelated private context.

## Milestone closeout

Before moving to the next milestone:

1. Run relevant tests.
2. Confirm every milestone acceptance criterion.
3. Export, sanitize and review relevant n8n workflow changes.
4. Update relevant architecture and implementation documentation, fixtures and reproduction instructions.
5. Update `docs/VIDEO_CHECKPOINTS.md` only if something genuinely video-worthy emerged.
6. Commit remaining documentation and evidence changes in meaningful commits.
7. Create the annotated local milestone tag on the completed, tested commit. If a confirmed video experiment also ends here, create its end tag only after its evidence and acceptance checks are complete.
8. Report to the user:
   - What was completed.
   - Tests and actual results.
   - Milestone tag.
   - Whether a worthwhile YouTube experiment now exists.
   - If yes, the technical question, evidence and reason it warrants a video.
   - If no, explicitly say **“No video is warranted yet.”**

If a gate fails, report what remains and do not create the completion tag. Do not start designing the next video automatically.
