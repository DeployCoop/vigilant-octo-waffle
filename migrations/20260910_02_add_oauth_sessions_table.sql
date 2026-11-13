-- 20260910_02_add_oauth_sessions_table
-- OAuth login sessions for the Keycloak-backed auth flow.
CREATE TABLE IF NOT EXISTS oauth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  refresh_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_sessions_user_id ON oauth_sessions (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_sessions_expires_at ON oauth_sessions (expires_at);
