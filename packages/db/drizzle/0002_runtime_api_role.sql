-- Runtime API login role + FORCE RLS on global auth tables (users/sessions).
--
-- Dev password is hardcoded for local docker only. Production MUST override:
--   ALTER ROLE datasheets_runtime PASSWORD '<strong-secret>';
--   (or create the role via secrets manager / IaC and skip this password.)
--
-- users / sessions are a global identity store (not company-scoped). Policies
-- allow datasheets_app full DML with USING (true) so login can look up by email
-- and resolve sessions by token. Session tokens should be stored hashed.
-- FORCE RLS ensures only BYPASSRLS roles (datasheets_owner) skip policies —
-- the table owner does not auto-bypass when FORCE is on.

-- ---------------------------------------------------------------------------
-- datasheets_runtime: API login role (NOSUPERUSER, NOBYPASSRLS, NOINHERIT app)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'datasheets_runtime') THEN
    CREATE ROLE datasheets_runtime
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      NOINHERIT
      PASSWORD 'datasheets_runtime';
  END IF;
END
$$;

-- Idempotent password reset for local/dev only (production must ALTER immediately)
ALTER ROLE datasheets_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD 'datasheets_runtime';

GRANT CONNECT ON DATABASE datasheets TO datasheets_runtime;
GRANT USAGE ON SCHEMA public TO datasheets_runtime;

-- Can SET ROLE datasheets_app, but does NOT inherit privileges until SET ROLE.
-- Do NOT grant datasheets_owner — runtime must never bypass RLS.
GRANT datasheets_app TO datasheets_runtime WITH INHERIT FALSE;

-- Migrate/seed helper: membership in owner for SET ROLE during privileged ops.
-- Prefer connecting as container superuser (`datasheets`) for migrate/seed; this
-- role exists so non-superuser migration tooling can be granted owner later.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'datasheets_migrate') THEN
    CREATE ROLE datasheets_migrate NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT datasheets_owner TO datasheets_migrate;

-- ---------------------------------------------------------------------------
-- users / sessions: ENABLE + FORCE RLS (global identity; open app policies)
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_app_all ON users;
CREATE POLICY users_app_all ON users
  FOR ALL TO datasheets_app
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS sessions_app_all ON sessions;
CREATE POLICY sessions_app_all ON sessions
  FOR ALL TO datasheets_app
  USING (true)
  WITH CHECK (true);
