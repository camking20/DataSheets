-- Phase 4 NC / CAPA

DO $$ BEGIN
  CREATE TYPE nc_status AS ENUM (
    'initiation',
    'containment',
    'disposition_planning',
    'disposition_execution',
    'investigation',
    'closure'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nc_disposition AS ENUM (
    'use_as_is',
    'rework',
    'repair',
    'scrap',
    'return_to_vendor'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nc_triage_decision AS ENUM (
    'acceptable',
    'nc',
    'nc_capa'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capa_status AS ENUM (
    'open', 'in_progress', 'verification', 'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capa_action_status AS ENUM (
    'pending', 'in_progress', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS nonconformances (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nc_number text NOT NULL,
  status nc_status NOT NULL DEFAULT 'initiation',
  title text,
  description text NOT NULL,
  is_acceptable boolean NOT NULL DEFAULT false,
  capa_required boolean NOT NULL DEFAULT false,
  part_id uuid,
  data_sheet_id uuid,
  work_order_id uuid,
  work_order_operation_id uuid,
  quantity_affected integer,
  flagged_qty integer,
  severity text,
  triage_decision nc_triage_decision,
  triaged_by uuid REFERENCES users(id),
  triaged_at timestamptz,
  disposition nc_disposition,
  disposition_notes text,
  containment_actions text,
  root_cause text,
  risk_analysis text,
  created_by uuid REFERENCES users(id),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, nc_number),
  FOREIGN KEY (company_id, part_id) REFERENCES parts(company_id, id),
  FOREIGN KEY (company_id, data_sheet_id) REFERENCES data_sheets(company_id, id),
  FOREIGN KEY (company_id, work_order_id) REFERENCES work_orders(company_id, id),
  FOREIGN KEY (company_id, work_order_operation_id)
    REFERENCES work_order_operations(company_id, id)
);
CREATE INDEX IF NOT EXISTS nonconformances_status_idx
  ON nonconformances(company_id, status);
CREATE INDEX IF NOT EXISTS nonconformances_part_idx
  ON nonconformances(company_id, part_id);
CREATE INDEX IF NOT EXISTS nonconformances_wo_idx
  ON nonconformances(company_id, work_order_id);

CREATE TABLE IF NOT EXISTS nc_events (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nonconformance_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status nc_status,
  to_status nc_status,
  actor_id uuid REFERENCES users(id),
  note text,
  signature_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, nonconformance_id)
    REFERENCES nonconformances(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, signature_id)
    REFERENCES signatures(company_id, id)
);
CREATE INDEX IF NOT EXISTS nc_events_nc_idx
  ON nc_events(company_id, nonconformance_id);
CREATE INDEX IF NOT EXISTS nc_events_created_idx
  ON nc_events(company_id, created_at);

CREATE TABLE IF NOT EXISTS capas (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  capa_number text NOT NULL,
  nonconformance_id uuid,
  title text,
  description text NOT NULL,
  status capa_status NOT NULL DEFAULT 'open',
  root_cause text,
  corrective_action text,
  preventive_action text,
  risk_assessment text,
  effectiveness_check text,
  effectiveness_verified_by uuid REFERENCES users(id),
  effectiveness_verified_at timestamptz,
  created_by uuid REFERENCES users(id),
  due_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, capa_number),
  FOREIGN KEY (company_id, nonconformance_id)
    REFERENCES nonconformances(company_id, id)
);
CREATE INDEX IF NOT EXISTS capas_status_idx ON capas(company_id, status);
CREATE INDEX IF NOT EXISTS capas_nc_idx ON capas(company_id, nonconformance_id);
CREATE INDEX IF NOT EXISTS capas_due_idx ON capas(company_id, due_at);

CREATE TABLE IF NOT EXISTS capa_actions (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  capa_id uuid NOT NULL,
  description text NOT NULL,
  action_type text,
  status capa_action_status NOT NULL DEFAULT 'pending',
  assignee_id uuid REFERENCES users(id),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, capa_id)
    REFERENCES capas(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS capa_actions_capa_idx
  ON capa_actions(company_id, capa_id);
CREATE INDEX IF NOT EXISTS capa_actions_status_idx
  ON capa_actions(company_id, status);

ALTER TABLE nonconformances OWNER TO datasheets_owner;
ALTER TABLE nc_events OWNER TO datasheets_owner;
ALTER TABLE capas OWNER TO datasheets_owner;
ALTER TABLE capa_actions OWNER TO datasheets_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  nonconformances, capas, capa_actions
TO datasheets_app;

GRANT SELECT, INSERT ON nc_events TO datasheets_app;

ALTER TABLE nonconformances ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonconformances FORCE ROW LEVEL SECURITY;
ALTER TABLE nc_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_events FORCE ROW LEVEL SECURITY;
ALTER TABLE capas ENABLE ROW LEVEL SECURITY;
ALTER TABLE capas FORCE ROW LEVEL SECURITY;
ALTER TABLE capa_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capa_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY nonconformances_tenant ON nonconformances
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY nc_events_select ON nc_events
  FOR SELECT TO datasheets_app
  USING (company_id = current_company_id());

CREATE POLICY nc_events_insert ON nc_events
  FOR INSERT TO datasheets_app
  WITH CHECK (company_id = current_company_id());

CREATE POLICY capas_tenant ON capas
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY capa_actions_tenant ON capa_actions
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
