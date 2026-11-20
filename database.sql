CREATE TABLE IF NOT EXISTS forma_users (
  email text PRIMARY KEY,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'aluno'))
);

CREATE TABLE IF NOT EXISTS forma_plans (
  email text PRIMARY KEY REFERENCES forma_users(email) ON DELETE CASCADE,
  revision text NOT NULL,
  workout jsonb NOT NULL,
  diet jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS forma_sessions (
  token_hash text PRIMARY KEY,
  email text NOT NULL REFERENCES forma_users(email) ON DELETE CASCADE,
  password_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS forma_sessions_expiry ON forma_sessions(expires_at);

CREATE TABLE IF NOT EXISTS forma_login_attempts (
  ip_hash text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);

CREATE INDEX IF NOT EXISTS forma_login_attempts_expiry ON forma_login_attempts(started_at);
