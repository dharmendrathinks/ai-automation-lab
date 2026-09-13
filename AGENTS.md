# AI Automation Lab implementation

- Follow `PLAN.md` and `docs/REPOSITORY_WORKFLOW.md`; preserve the engineering milestones.
- Correct engineering is primary. Video checkpoints require real experiments and evidence.
- Keep the Codex feasibility spike bounded. Record and freeze its result, then build RelayDesk and n8n.
- Default to FIXTURE MODE. Live inference is opt-in and must not inherit developer credentials or tools.
- Use synthetic data only. Never commit credentials, raw model reasoning, or unsanitized runtime logs.
- Backend code owns policy, approval, business state and verification. n8n owns orchestration.
- Run relevant tests and type checks. Make coherent incremental commits and tag only completed milestones.
- Keep commits and tags local unless pushing is explicitly required by the user or repository workflow.
