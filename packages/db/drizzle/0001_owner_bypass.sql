-- Owner role must bypass RLS for migrations/seed (FORCE RLS applies to table owners)
ALTER ROLE datasheets_owner BYPASSRLS;
