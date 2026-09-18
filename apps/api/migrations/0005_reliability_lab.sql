CREATE TABLE scenario_instances (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES automation_runs(id),
  fixture_id text NOT NULL,
  config jsonb NOT NULL,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE action_attempts (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES proposed_actions(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  result text NOT NULL CHECK (result IN ('started', 'failed_before_commit', 'committed_response_lost', 'success_without_mutation', 'committed', 'idempotent_replay')),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (action_id, attempt)
);
