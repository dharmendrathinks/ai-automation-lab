CREATE TABLE proposed_actions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES automation_runs(id),
  kind text NOT NULL CHECK (kind IN ('support_response', 'refund')),
  parameters jsonb NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'pending_approval', 'approved', 'rejected', 'executing', 'verified', 'failed', 'unknown')),
  idempotency_key text NOT NULL UNIQUE,
  business_outcome text NOT NULL DEFAULT 'pending' CHECK (business_outcome IN ('pending', 'verified', 'failed', 'unknown', 'not_performed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX one_support_action_per_run ON proposed_actions(run_id, kind);

CREATE TABLE ticket_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id),
  action_id uuid NOT NULL UNIQUE REFERENCES proposed_actions(id),
  author_type text NOT NULL CHECK (author_type IN ('automation', 'human')),
  text text NOT NULL,
  visibility text NOT NULL CHECK (visibility = 'customer'),
  created_at timestamptz NOT NULL
);

CREATE TABLE operation_receipts (
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (operation, idempotency_key)
);
