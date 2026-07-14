-- Bootstrap company + admin membership without SET ROLE datasheets_owner at runtime.
-- SECURITY DEFINER runs as datasheets_owner (BYPASSRLS) so company insert works
-- despite companies_insert requiring app.company_id to match the new row id.
-- Production should keep EXECUTE grants narrow; the API login role must NOT
-- retain SET ROLE datasheets_owner once tenancy hardening lands.

CREATE OR REPLACE FUNCTION create_company_with_owner(
  p_name text,
  p_slug text,
  p_settings jsonb,
  p_user_id uuid,
  p_role membership_role DEFAULT 'admin'
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  settings jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company companies%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  INSERT INTO companies (name, slug, settings)
  VALUES (p_name, p_slug, COALESCE(p_settings, '{}'::jsonb))
  RETURNING * INTO v_company;

  INSERT INTO memberships (company_id, user_id, role)
  VALUES (v_company.id, p_user_id, COALESCE(p_role, 'admin'::membership_role));

  id := v_company.id;
  name := v_company.name;
  slug := v_company.slug;
  settings := v_company.settings;
  created_at := v_company.created_at;
  updated_at := v_company.updated_at;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION create_company_with_owner(text, text, jsonb, uuid, membership_role)
  OWNER TO datasheets_owner;

REVOKE ALL ON FUNCTION create_company_with_owner(text, text, jsonb, uuid, membership_role)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_company_with_owner(text, text, jsonb, uuid, membership_role)
  TO datasheets_app;
