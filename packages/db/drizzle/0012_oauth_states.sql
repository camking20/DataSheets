-- Short-lived Google OAuth CSRF state (cross-process; not tenant-scoped RLS).
-- Looked up by opaque state nonce before tenant context is established on callback.

CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  state text NOT NULL UNIQUE,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_states OWNER TO datasheets_owner;

GRANT SELECT, INSERT, DELETE ON oauth_states TO datasheets_app;

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states FORCE ROW LEVEL SECURITY;

-- Global table (like sessions): open policies so callback can consume without tenant GUC.
DROP POLICY IF EXISTS oauth_states_app_select ON oauth_states;
CREATE POLICY oauth_states_app_select ON oauth_states
  FOR SELECT TO datasheets_app
  USING (true);

DROP POLICY IF EXISTS oauth_states_app_insert ON oauth_states;
CREATE POLICY oauth_states_app_insert ON oauth_states
  FOR INSERT TO datasheets_app
  WITH CHECK (true);

DROP POLICY IF EXISTS oauth_states_app_delete ON oauth_states;
CREATE POLICY oauth_states_app_delete ON oauth_states
  FOR DELETE TO datasheets_app
  USING (true);

CREATE INDEX oauth_states_expires_at_idx ON oauth_states (expires_at);
