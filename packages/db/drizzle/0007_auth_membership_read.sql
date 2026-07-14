-- Allow auth bootstrap to read a user's own memberships/companies without
-- app.company_id already set (chicken-and-egg on login / resolveSession).
-- Writes remain strictly tenant-scoped via app.company_id.

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

ALTER FUNCTION current_user_id() OWNER TO datasheets_owner;

-- memberships: split read vs write
DROP POLICY IF EXISTS memberships_tenant ON memberships;

CREATE POLICY memberships_select ON memberships
  FOR SELECT TO datasheets_app
  USING (
    company_id = current_company_id()
    OR (current_user_id() IS NOT NULL AND user_id = current_user_id())
  );

CREATE POLICY memberships_insert ON memberships
  FOR INSERT TO datasheets_app
  WITH CHECK (company_id = current_company_id());

CREATE POLICY memberships_update ON memberships
  FOR UPDATE TO datasheets_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY memberships_delete ON memberships
  FOR DELETE TO datasheets_app
  USING (company_id = current_company_id());

-- companies: SELECT own via membership when user GUC is set
DROP POLICY IF EXISTS companies_self ON companies;

CREATE POLICY companies_select ON companies
  FOR SELECT TO datasheets_app
  USING (
    id = current_company_id()
    OR (
      current_user_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM memberships m
        WHERE m.company_id = companies.id
          AND m.user_id = current_user_id()
      )
    )
  );
