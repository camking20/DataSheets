-- Part 11 immutability: append-only grants + signature signer NOT NULL
-- Does not drop or alter RLS policies.

-- ---------------------------------------------------------------------------
-- Soft-deletable QMS entities: app may SELECT/INSERT/UPDATE but not DELETE
-- ---------------------------------------------------------------------------
REVOKE DELETE ON
  nonconformances, capas, capa_actions, files
FROM datasheets_app;

GRANT SELECT, INSERT, UPDATE ON
  nonconformances, capas, capa_actions, files
TO datasheets_app;

-- ---------------------------------------------------------------------------
-- Append-only audit trail
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON audit_logs FROM datasheets_app;

GRANT SELECT, INSERT ON audit_logs TO datasheets_app;

-- ---------------------------------------------------------------------------
-- Frozen DHR document snapshots (append-only)
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON work_order_operation_documents FROM datasheets_app;

GRANT SELECT, INSERT ON work_order_operation_documents TO datasheets_app;

-- ---------------------------------------------------------------------------
-- Signatures: require signer identity (Part 11 attribution)
-- ---------------------------------------------------------------------------
-- Clear optional refs so orphan null-signer rows can be removed
UPDATE nc_events ne
SET signature_id = NULL
FROM signatures s
WHERE ne.company_id = s.company_id
  AND ne.signature_id = s.id
  AND s.signer_id IS NULL;

DELETE FROM signatures WHERE signer_id IS NULL;

UPDATE signatures
SET signer_name = 'Unknown'
WHERE signer_name IS NULL;

ALTER TABLE signatures
  ALTER COLUMN signer_id SET NOT NULL;

ALTER TABLE signatures
  ALTER COLUMN signer_name SET NOT NULL;
