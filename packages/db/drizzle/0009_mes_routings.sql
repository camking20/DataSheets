-- Phase 2 MES: routings, work orders, append-only executions, frozen op documents
-- Also: data_sheets.work_order_operation_id, change_order_items.routing_revision_id

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE work_order_status AS ENUM (
    'planned',
    'released',
    'in_progress',
    'on_hold',
    'completed',
    'closed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wo_op_document_role AS ENUM ('wi', 'drawing', 'procedure');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Routings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routings (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  part_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, part_id) REFERENCES parts(company_id, id)
);
CREATE INDEX IF NOT EXISTS routings_part_idx ON routings(company_id, part_id);

CREATE TABLE IF NOT EXISTS routing_revisions (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  routing_id uuid NOT NULL,
  rev text NOT NULL,
  status revision_status NOT NULL DEFAULT 'draft',
  change_summary text,
  created_by uuid REFERENCES users(id),
  released_at timestamptz,
  released_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, routing_id, rev),
  FOREIGN KEY (company_id, routing_id)
    REFERENCES routings(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS routing_revisions_routing_idx
  ON routing_revisions(company_id, routing_id);
CREATE INDEX IF NOT EXISTS routing_revisions_status_idx
  ON routing_revisions(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS routing_revisions_one_released_uq
  ON routing_revisions (company_id, routing_id)
  WHERE status = 'released';

CREATE TABLE IF NOT EXISTS routing_operations (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  routing_revision_id uuid NOT NULL,
  op_number integer NOT NULL,
  name text NOT NULL,
  work_center text,
  wi_document_id uuid,
  requires_data_sheet boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, routing_revision_id, op_number),
  FOREIGN KEY (company_id, routing_revision_id)
    REFERENCES routing_revisions(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, wi_document_id)
    REFERENCES documents(company_id, id),
  CONSTRAINT routing_operations_op_number_positive CHECK (op_number > 0)
);
CREATE INDEX IF NOT EXISTS routing_operations_revision_idx
  ON routing_operations(company_id, routing_revision_id);

-- ---------------------------------------------------------------------------
-- Work orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  wo_number text NOT NULL,
  part_id uuid NOT NULL,
  part_revision_id uuid NOT NULL,
  routing_revision_id uuid NOT NULL,
  qty integer NOT NULL,
  lot_number text,
  status work_order_status NOT NULL DEFAULT 'planned',
  created_by uuid REFERENCES users(id),
  released_at timestamptz,
  released_by uuid REFERENCES users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, wo_number),
  FOREIGN KEY (company_id, part_id) REFERENCES parts(company_id, id),
  FOREIGN KEY (company_id, part_revision_id)
    REFERENCES part_revisions(company_id, id),
  FOREIGN KEY (company_id, routing_revision_id)
    REFERENCES routing_revisions(company_id, id),
  CONSTRAINT work_orders_qty_positive CHECK (qty > 0),
  CONSTRAINT work_orders_qty_max CHECK (qty <= 100000)
);
CREATE INDEX IF NOT EXISTS work_orders_part_idx ON work_orders(company_id, part_id);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders(company_id, status);
CREATE INDEX IF NOT EXISTS work_orders_lot_idx ON work_orders(company_id, lot_number);

CREATE TABLE IF NOT EXISTS work_order_operations (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  routing_operation_id uuid NOT NULL,
  qty_complete integer NOT NULL DEFAULT 0,
  qty_scrap integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  started_by uuid REFERENCES users(id),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  snapshot jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, work_order_id, routing_operation_id),
  FOREIGN KEY (company_id, work_order_id)
    REFERENCES work_orders(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, routing_operation_id)
    REFERENCES routing_operations(company_id, id),
  CONSTRAINT work_order_operations_qty_complete_nonneg CHECK (qty_complete >= 0),
  CONSTRAINT work_order_operations_qty_scrap_nonneg CHECK (qty_scrap >= 0)
);
CREATE INDEX IF NOT EXISTS work_order_operations_wo_idx
  ON work_order_operations(company_id, work_order_id);

-- Append-only execution ledger
CREATE TABLE IF NOT EXISTS operation_executions (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  work_order_operation_id uuid NOT NULL,
  qty_good integer NOT NULL DEFAULT 0,
  qty_scrap integer NOT NULL DEFAULT 0,
  performed_by uuid NOT NULL REFERENCES users(id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  reason text,
  data_sheet_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, work_order_operation_id)
    REFERENCES work_order_operations(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, data_sheet_id)
    REFERENCES data_sheets(company_id, id)
);
CREATE INDEX IF NOT EXISTS operation_executions_woo_idx
  ON operation_executions(company_id, work_order_operation_id);
CREATE INDEX IF NOT EXISTS operation_executions_performed_idx
  ON operation_executions(company_id, performed_at);

-- Frozen document revisions at op start
CREATE TABLE IF NOT EXISTS work_order_operation_documents (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  work_order_operation_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_revision_id uuid NOT NULL,
  role wo_op_document_role NOT NULL,
  snapshot jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, work_order_operation_id)
    REFERENCES work_order_operations(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, document_id)
    REFERENCES documents(company_id, id),
  FOREIGN KEY (company_id, document_revision_id)
    REFERENCES document_revisions(company_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS wo_op_docs_woo_role_uidx
  ON work_order_operation_documents (company_id, work_order_operation_id, role, document_id);
CREATE INDEX IF NOT EXISTS wo_op_docs_woo_idx
  ON work_order_operation_documents(company_id, work_order_operation_id);

-- ---------------------------------------------------------------------------
-- Alter existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE data_sheets
  ADD COLUMN IF NOT EXISTS work_order_operation_id uuid;

DO $$ BEGIN
  ALTER TABLE data_sheets
    ADD CONSTRAINT data_sheets_woo_fk
    FOREIGN KEY (company_id, work_order_operation_id)
    REFERENCES work_order_operations(company_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS data_sheets_woo_idx
  ON data_sheets(company_id, work_order_operation_id);

-- change_order_items: allow routing OR document revision
ALTER TABLE change_order_items
  ALTER COLUMN document_revision_id DROP NOT NULL;

ALTER TABLE change_order_items
  ADD COLUMN IF NOT EXISTS routing_revision_id uuid;

DO $$ BEGIN
  ALTER TABLE change_order_items
    ADD CONSTRAINT change_order_items_exactly_one_rev
    CHECK (
      (document_revision_id IS NOT NULL AND routing_revision_id IS NULL)
      OR (document_revision_id IS NULL AND routing_revision_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE change_order_items
    ADD CONSTRAINT change_order_items_routing_rev_fk
    FOREIGN KEY (company_id, routing_revision_id)
    REFERENCES routing_revisions(company_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS change_order_items_co_rev_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS change_order_items_co_doc_rev_uidx
  ON change_order_items (company_id, change_order_id, document_revision_id)
  WHERE document_revision_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS change_order_items_co_rtg_rev_uidx
  ON change_order_items (company_id, change_order_id, routing_revision_id)
  WHERE routing_revision_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Ownership / grants / RLS
-- ---------------------------------------------------------------------------
ALTER TABLE routings OWNER TO datasheets_owner;
ALTER TABLE routing_revisions OWNER TO datasheets_owner;
ALTER TABLE routing_operations OWNER TO datasheets_owner;
ALTER TABLE work_orders OWNER TO datasheets_owner;
ALTER TABLE work_order_operations OWNER TO datasheets_owner;
ALTER TABLE operation_executions OWNER TO datasheets_owner;
ALTER TABLE work_order_operation_documents OWNER TO datasheets_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  routings, routing_revisions, routing_operations,
  work_orders, work_order_operations, work_order_operation_documents
TO datasheets_app;

-- Append-only: no UPDATE/DELETE
GRANT SELECT, INSERT ON operation_executions TO datasheets_app;

ALTER TABLE routings ENABLE ROW LEVEL SECURITY;
ALTER TABLE routings FORCE ROW LEVEL SECURITY;
ALTER TABLE routing_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE routing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE operation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order_operation_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_operation_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY routings_tenant ON routings
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY routing_revisions_tenant ON routing_revisions
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY routing_operations_tenant ON routing_operations
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY work_orders_tenant ON work_orders
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY work_order_operations_tenant ON work_order_operations
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY operation_executions_select ON operation_executions
  FOR SELECT TO datasheets_app
  USING (company_id = current_company_id());

CREATE POLICY operation_executions_insert ON operation_executions
  FOR INSERT TO datasheets_app
  WITH CHECK (company_id = current_company_id());

CREATE POLICY work_order_operation_documents_tenant ON work_order_operation_documents
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
