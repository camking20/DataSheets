-- Concurrency guards: at most one current measurement per sample cell,
-- one released revision per part, and unique lot numbers per revision.

-- Dedupe duplicate lots (keep newest sheet) before unique index.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, part_revision_id, lot_number
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM data_sheets
)
UPDATE data_sheets d
SET lot_number = d.lot_number || '-dup-' || substr(d.id::text, 1, 8)
FROM ranked r
WHERE d.id = r.id
  AND r.rn > 1;

-- If multiple is_current rows exist for the same cell, keep newest as current.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, data_sheet_id, dimension_id, sample_index
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM measurements
  WHERE is_current = true
)
UPDATE measurements m
SET is_current = false
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1;

-- If multiple released revisions exist for a part, keep newest released.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, part_id
      ORDER BY released_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM part_revisions
  WHERE status = 'released'
)
UPDATE part_revisions p
SET status = 'superseded'
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS measurements_one_current_uq
  ON measurements (company_id, data_sheet_id, dimension_id, sample_index)
  WHERE is_current = true;

CREATE UNIQUE INDEX IF NOT EXISTS part_revisions_one_released_uq
  ON part_revisions (company_id, part_id)
  WHERE status = 'released';

CREATE UNIQUE INDEX IF NOT EXISTS data_sheets_lot_uq
  ON data_sheets (company_id, part_revision_id, lot_number);
