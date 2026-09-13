CREATE TABLE customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email LIKE '%@example.test'),
  account_plan text NOT NULL CHECK (account_plan IN ('free', 'pro')),
  account_status text NOT NULL CHECK (account_status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL
);
CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  customer_id text NOT NULL UNIQUE REFERENCES customers(id),
  plan text NOT NULL CHECK (plan IN ('free', 'pro')),
  status text NOT NULL CHECK (status IN ('active', 'cancelled')),
  renewal_date timestamptz NOT NULL,
  UNIQUE (id, customer_id)
);
CREATE TABLE invoices (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  subscription_id text NOT NULL,
  billing_period text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  FOREIGN KEY (subscription_id, customer_id) REFERENCES subscriptions(id, customer_id),
  UNIQUE (id, customer_id)
);
CREATE TABLE payments (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  invoice_id text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  status text NOT NULL CHECK (status IN ('captured', 'failed')),
  refunded_amount_minor integer NOT NULL DEFAULT 0
    CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amount_minor),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (invoice_id, customer_id) REFERENCES invoices(id, customer_id)
);
CREATE TABLE tickets (
  id uuid PRIMARY KEY,
  customer_id text REFERENCES customers(id),
  customer_ref text NOT NULL,
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 8000),
  status text NOT NULL CHECK (status IN ('open', 'awaiting_customer', 'human_follow_up', 'resolved')),
  created_at timestamptz NOT NULL
);
CREATE TABLE automation_runs (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id),
  phase text NOT NULL CHECK (phase IN ('pending', 'triage', 'human_review', 'completed')),
  mode text NOT NULL CHECK (mode = 'FIXTURE MODE'),
  created_at timestamptz NOT NULL
);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES automation_runs(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL
);
CREATE INDEX outbox_pending ON outbox_events(created_at) WHERE status = 'pending';
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES automation_runs(id),
  event_type text NOT NULL,
  actor text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX audit_run ON audit_events(run_id, created_at);
