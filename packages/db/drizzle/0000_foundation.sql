-- DataSheets: foundation migration
-- Roles, uuid helper, composite FKs, Row-Level Security

-- ---------------------------------------------------------------------------
-- Roles: owner (migrations/seed) vs app (runtime, RLS enforced)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'datasheets_owner') THEN
    CREATE ROLE datasheets_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'datasheets_app') THEN
    CREATE ROLE datasheets_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- uuidv7 helper (compatible with PG 16; uses time-ordered UUID v7 layout)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112); -- version 7
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128); -- variant 10
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE membership_role AS ENUM ('operator', 'engineer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE revision_status AS ENUM ('draft', 'released', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sheet_status AS ENUM ('in_progress', 'completed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE frequency_type AS ENUM ('every_n_parts', 'sample_size_per_lot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE disposition AS ENUM ('green', 'yellow', 'red');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  password_hash text,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  active_company_id uuid REFERENCES companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role membership_role NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);

CREATE TABLE IF NOT EXISTS parts (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  part_number text NOT NULL,
  description text,
  customer text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, part_number)
);

CREATE TABLE IF NOT EXISTS part_revisions (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  part_id uuid NOT NULL,
  rev text NOT NULL,
  status revision_status NOT NULL DEFAULT 'draft',
  notes text,
  released_at timestamptz,
  released_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, part_id, rev),
  FOREIGN KEY (company_id, part_id) REFERENCES parts(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS part_revisions_part_idx ON part_revisions(company_id, part_id);

CREATE TABLE IF NOT EXISTS dimensions (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  part_revision_id uuid NOT NULL,
  name text NOT NULL,
  balloon_number text,
  unit text NOT NULL DEFAULT 'in',
  nominal double precision NOT NULL,
  usl double precision,
  lsl double precision,
  warning_fraction double precision NOT NULL DEFAULT 0.75,
  gage_method text,
  frequency_type frequency_type NOT NULL DEFAULT 'every_n_parts',
  frequency_n integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, part_revision_id) REFERENCES part_revisions(company_id, id) ON DELETE CASCADE,
  CONSTRAINT dimensions_has_limit CHECK (usl IS NOT NULL OR lsl IS NOT NULL),
  CONSTRAINT dimensions_warning_fraction CHECK (warning_fraction >= 0 AND warning_fraction <= 1)
);
CREATE INDEX IF NOT EXISTS dimensions_revision_idx ON dimensions(company_id, part_revision_id);

CREATE TABLE IF NOT EXISTS data_sheets (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  part_revision_id uuid NOT NULL,
  lot_number text NOT NULL,
  lot_size integer NOT NULL,
  status sheet_status NOT NULL DEFAULT 'in_progress',
  operator_id uuid REFERENCES users(id),
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, part_revision_id) REFERENCES part_revisions(company_id, id),
  CONSTRAINT data_sheets_lot_size_positive CHECK (lot_size > 0)
);
CREATE INDEX IF NOT EXISTS data_sheets_revision_idx ON data_sheets(company_id, part_revision_id);
CREATE INDEX IF NOT EXISTS data_sheets_status_idx ON data_sheets(company_id, status);

CREATE TABLE IF NOT EXISTS measurements (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  data_sheet_id uuid NOT NULL,
  dimension_id uuid NOT NULL,
  sample_index integer NOT NULL,
  value double precision NOT NULL,
  disposition disposition NOT NULL,
  measured_by uuid REFERENCES users(id),
  measured_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, data_sheet_id) REFERENCES data_sheets(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, dimension_id) REFERENCES dimensions(company_id, id),
  CONSTRAINT measurements_sample_index_nonneg CHECK (sample_index >= 0)
);
CREATE INDEX IF NOT EXISTS measurements_sheet_idx ON measurements(company_id, data_sheet_id);
CREATE INDEX IF NOT EXISTS measurements_current_idx
  ON measurements(company_id, data_sheet_id, dimension_id, sample_index, is_current);

CREATE TABLE IF NOT EXISTS capability_snapshots (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  data_sheet_id uuid NOT NULL,
  dimension_id uuid NOT NULL,
  part_id uuid NOT NULL,
  n integer NOT NULL,
  mean double precision,
  std_dev double precision,
  cp double precision,
  cpk double precision,
  percent_yellow double precision NOT NULL DEFAULT 0,
  percent_red double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, data_sheet_id) REFERENCES data_sheets(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, dimension_id) REFERENCES dimensions(company_id, id),
  FOREIGN KEY (company_id, part_id) REFERENCES parts(company_id, id),
  UNIQUE (company_id, data_sheet_id, dimension_id)
);
CREATE INDEX IF NOT EXISTS capability_part_idx ON capability_snapshots(company_id, part_id);
CREATE INDEX IF NOT EXISTS capability_dimension_idx ON capability_snapshots(company_id, dimension_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(company_id, created_at);

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  data_sheet_id uuid NOT NULL,
  format text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid REFERENCES users(id),
  file_name text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, data_sheet_id) REFERENCES data_sheets(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS export_jobs_sheet_idx ON export_jobs(company_id, data_sheet_id);

-- ---------------------------------------------------------------------------
-- Ownership: tables owned by datasheets_owner; app role has DML only
-- ---------------------------------------------------------------------------
ALTER TABLE companies OWNER TO datasheets_owner;
ALTER TABLE users OWNER TO datasheets_owner;
ALTER TABLE sessions OWNER TO datasheets_owner;
ALTER TABLE memberships OWNER TO datasheets_owner;
ALTER TABLE parts OWNER TO datasheets_owner;
ALTER TABLE part_revisions OWNER TO datasheets_owner;
ALTER TABLE dimensions OWNER TO datasheets_owner;
ALTER TABLE data_sheets OWNER TO datasheets_owner;
ALTER TABLE measurements OWNER TO datasheets_owner;
ALTER TABLE capability_snapshots OWNER TO datasheets_owner;
ALTER TABLE audit_logs OWNER TO datasheets_owner;
ALTER TABLE export_jobs OWNER TO datasheets_owner;

GRANT USAGE ON SCHEMA public TO datasheets_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  companies, users, sessions, memberships, parts, part_revisions,
  dimensions, data_sheets, measurements, capability_snapshots,
  audit_logs, export_jobs
TO datasheets_app;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts FORCE ROW LEVEL SECURITY;
ALTER TABLE part_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimensions FORCE ROW LEVEL SECURITY;
ALTER TABLE data_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sheets FORCE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements FORCE ROW LEVEL SECURITY;
ALTER TABLE capability_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;

-- Helper: current tenant from session GUC
CREATE OR REPLACE FUNCTION current_company_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE POLICY memberships_tenant ON memberships
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY parts_tenant ON parts
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY part_revisions_tenant ON part_revisions
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY dimensions_tenant ON dimensions
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY data_sheets_tenant ON data_sheets
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY measurements_tenant ON measurements
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY capability_snapshots_tenant ON capability_snapshots
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY audit_logs_tenant ON audit_logs
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY export_jobs_tenant ON export_jobs
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- Companies: members can only see their own company when GUC is set
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;

CREATE POLICY companies_self ON companies
  FOR SELECT TO datasheets_app
  USING (id = current_company_id());

CREATE POLICY companies_update_self ON companies
  FOR UPDATE TO datasheets_app
  USING (id = current_company_id())
  WITH CHECK (id = current_company_id());

-- Allow INSERT during onboarding when GUC matches new id
CREATE POLICY companies_insert ON companies
  FOR INSERT TO datasheets_app
  WITH CHECK (id = current_company_id());
