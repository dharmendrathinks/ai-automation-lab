CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES proposed_actions(id),
  proposal_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewer text,
  decision_reason text,
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY,
  payment_id text NOT NULL UNIQUE REFERENCES payments(id),
  action_id uuid NOT NULL UNIQUE REFERENCES proposed_actions(id),
  customer_id text NOT NULL REFERENCES customers(id),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  status text NOT NULL CHECK (status = 'completed'),
  created_at timestamptz NOT NULL
);
