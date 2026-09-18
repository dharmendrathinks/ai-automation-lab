ALTER TABLE automation_runs
  ADD COLUMN decision jsonb,
  ADD COLUMN policy_result jsonb,
  ADD COLUMN outcome text,
  ADD COLUMN escalation_reason text,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN completed_at timestamptz;

ALTER TABLE outbox_events
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN last_error text,
  ADD COLUMN next_attempt_at timestamptz;

CREATE TABLE ai_jobs (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES automation_runs(id),
  task text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  result jsonb,
  error_code text,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  UNIQUE (run_id, task)
);

CREATE TABLE workflow_executions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES automation_runs(id),
  event_id uuid NOT NULL REFERENCES outbox_events(id),
  workflow_revision text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  technical_status text NOT NULL CHECK (technical_status IN ('claimed', 'completed', 'failed')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (event_id)
);
