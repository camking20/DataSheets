-- QMS / controlled documents: enums, tables, RLS, grants

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'quality';

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('drw', 'pro', 'wi', 'frm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_revision_status AS ENUM (
    'draft', 'in_review', 'released', 'superseded', 'obsolete'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signature_meaning AS ENUM (
    'me_approval',
    'qa_approval',
    'disposition',
    'closure',
    'change_approval_me',
    'change_approval_qa'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE change_order_status AS ENUM (
    'draft', 'in_review', 'approved', 'rejected', 'implemented'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE file_kind AS ENUM ('pdf', 'cad', 'image', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  size_bytes integer,
  mime_type text,
  kind file_kind,
  original_name text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS files_sha256_idx ON files(company_id, sha256);

CREATE TABLE IF NOT EXISTS number_counters (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prefix text NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, prefix)
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_number text NOT NULL,
  doc_type document_type NOT NULL,
  title text,
  part_id uuid,
  source_frm_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, doc_number),
  FOREIGN KEY (company_id, part_id) REFERENCES parts(company_id, id),
  FOREIGN KEY (company_id, source_frm_id) REFERENCES documents(company_id, id)
);
CREATE INDEX IF NOT EXISTS documents_part_idx ON documents(company_id, part_id);
CREATE INDEX IF NOT EXISTS documents_type_idx ON documents(company_id, doc_type);

CREATE TABLE IF NOT EXISTS document_revisions (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  document_id uuid NOT NULL,
  rev text NOT NULL,
  status document_revision_status NOT NULL DEFAULT 'draft',
  google_file_id text,
  pdf_file_id uuid,
  cad_file_id uuid,
  change_summary text,
  created_by uuid REFERENCES users(id),
  released_at timestamptz,
  released_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, document_id, rev),
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, pdf_file_id) REFERENCES files(company_id, id),
  FOREIGN KEY (company_id, cad_file_id) REFERENCES files(company_id, id)
);
CREATE INDEX IF NOT EXISTS document_revisions_document_idx
  ON document_revisions(company_id, document_id);
CREATE INDEX IF NOT EXISTS document_revisions_status_idx
  ON document_revisions(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS document_revisions_one_released_uq
  ON document_revisions (company_id, document_id)
  WHERE status = 'released';

-- Immutable audit records (no updated_at)
CREATE TABLE IF NOT EXISTS signatures (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  meaning signature_meaning NOT NULL,
  signer_id uuid REFERENCES users(id),
  signer_name text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  content_sha256 text NOT NULL,
  password_verified boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS signatures_entity_idx
  ON signatures(company_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS signatures_signed_at_idx
  ON signatures(company_id, signed_at);

CREATE TABLE IF NOT EXISTS change_orders (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  co_number text NOT NULL,
  title text,
  description text NOT NULL,
  reason text NOT NULL,
  status change_order_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES users(id),
  approved_at timestamptz,
  implemented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, co_number)
);
CREATE INDEX IF NOT EXISTS change_orders_status_idx
  ON change_orders(company_id, status);

CREATE TABLE IF NOT EXISTS change_order_items (
  id uuid NOT NULL DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  change_order_id uuid NOT NULL,
  document_revision_id uuid NOT NULL,
  notes text,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, change_order_id, document_revision_id),
  FOREIGN KEY (company_id, change_order_id)
    REFERENCES change_orders(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, document_revision_id)
    REFERENCES document_revisions(company_id, id)
);
CREATE INDEX IF NOT EXISTS change_order_items_co_idx
  ON change_order_items(company_id, change_order_id);

CREATE TABLE IF NOT EXISTS google_connections (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  encrypted_refresh_token text,
  account_email text,
  root_folder_id text,
  folders jsonb DEFAULT '{}'::jsonb,
  connected_by uuid REFERENCES users(id),
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------
ALTER TABLE files OWNER TO datasheets_owner;
ALTER TABLE number_counters OWNER TO datasheets_owner;
ALTER TABLE documents OWNER TO datasheets_owner;
ALTER TABLE document_revisions OWNER TO datasheets_owner;
ALTER TABLE signatures OWNER TO datasheets_owner;
ALTER TABLE change_orders OWNER TO datasheets_owner;
ALTER TABLE change_order_items OWNER TO datasheets_owner;
ALTER TABLE google_connections OWNER TO datasheets_owner;

-- ---------------------------------------------------------------------------
-- Grants (signatures are append-only: SELECT + INSERT only)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  files, number_counters, documents, document_revisions,
  change_orders, change_order_items, google_connections
TO datasheets_app;

GRANT SELECT, INSERT ON signatures TO datasheets_app;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
ALTER TABLE number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE signatures FORCE ROW LEVEL SECURITY;
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE change_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY files_tenant ON files
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY number_counters_tenant ON number_counters
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY documents_tenant ON documents
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY document_revisions_tenant ON document_revisions
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY signatures_select ON signatures
  FOR SELECT TO datasheets_app
  USING (company_id = current_company_id());

CREATE POLICY signatures_insert ON signatures
  FOR INSERT TO datasheets_app
  WITH CHECK (company_id = current_company_id());

CREATE POLICY change_orders_tenant ON change_orders
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY change_order_items_tenant ON change_order_items
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY google_connections_tenant ON google_connections
  FOR ALL TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
