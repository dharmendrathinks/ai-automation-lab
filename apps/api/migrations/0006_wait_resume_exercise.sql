CREATE TABLE wait_exercises (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'callback_sent', 'completed', 'expired')),
  resume_url text,
  callback_attempts integer NOT NULL DEFAULT 0 CHECK (callback_attempts >= 0),
  approved_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
