import { createHash, randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function resolveSeedPassword(): string {
  const fromEnv = process.env.SEED_PASSWORD;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SEED_PASSWORD is required when NODE_ENV=production. Refusing to seed with a default password.",
    );
  }
  console.warn(
    "SEED_PASSWORD unset — using default password123 (non-production only).",
  );
  return "password123";
}

async function main() {
  const url =
    process.env.DATABASE_URL ??
    "postgresql://datasheets:datasheets@localhost:5432/datasheets";

  const sql = postgres(url, { max: 1 });

  // Seed as owner (bypass RLS)
  await sql`SET ROLE datasheets_owner`;

  const seedPassword = resolveSeedPassword();
  const passwordHash = hashPassword(seedPassword);

  const [companyA] = await sql`
    INSERT INTO companies (name, slug, settings)
    VALUES (
      'Precision Machine Works',
      'precision-mw',
      '{"defaultWarningFraction": 0.75, "defaultUnit": "in"}'::jsonb
    )
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
  `;

  const [companyB] = await sql`
    INSERT INTO companies (name, slug, settings)
    VALUES (
      'Apex Aerospace CNC',
      'apex-aero',
      '{"defaultWarningFraction": 0.75, "defaultUnit": "in"}'::jsonb
    )
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
  `;

  const [admin] = await sql`
    INSERT INTO users (email, name, password_hash, email_verified)
    VALUES ('admin@precision.local', 'Alex Engineer', ${passwordHash}, true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  const [operator] = await sql`
    INSERT INTO users (email, name, password_hash, email_verified)
    VALUES ('operator@precision.local', 'Sam Operator', ${passwordHash}, true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  const [outsider] = await sql`
    INSERT INTO users (email, name, password_hash, email_verified)
    VALUES ('admin@apex.local', 'Jordan Apex', ${passwordHash}, true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  const [quality] = await sql`
    INSERT INTO users (email, name, password_hash, email_verified)
    VALUES ('quality@precision.local', 'Quinn Quality', ${passwordHash}, true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  await sql`
    INSERT INTO memberships (company_id, user_id, role)
    VALUES
      (${companyA!.id}, ${admin!.id}, 'admin'),
      (${companyA!.id}, ${operator!.id}, 'operator'),
      (${companyA!.id}, ${quality!.id}, 'quality'),
      (${companyB!.id}, ${outsider!.id}, 'admin')
    ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;

  const [part] = await sql`
    INSERT INTO parts (company_id, part_number, description, customer)
    VALUES (
      ${companyA!.id},
      'PN-1042-A',
      'Hydraulic manifold body',
      'Acme Hydraulics'
    )
    ON CONFLICT (company_id, part_number) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
  `;

  const [rev] = await sql`
    INSERT INTO part_revisions (company_id, part_id, rev, status, released_at, released_by)
    VALUES (
      ${companyA!.id},
      ${part!.id},
      'A',
      'released',
      now(),
      ${admin!.id}
    )
    ON CONFLICT (company_id, part_id, rev) DO UPDATE SET status = 'released'
    RETURNING id
  `;

  // Preserve existing dimensions/measurements on re-seed (FK from measurements)
  const existingDims = await sql`
    SELECT id FROM dimensions
    WHERE company_id = ${companyA!.id} AND part_revision_id = ${rev!.id}
    LIMIT 1
  `;
  if (existingDims.length === 0) {
    await sql`
      INSERT INTO dimensions (
        company_id, part_revision_id, name, balloon_number, unit,
        nominal, usl, lsl, warning_fraction, gage_method,
        frequency_type, frequency_n, display_order
      ) VALUES
        (${companyA!.id}, ${rev!.id}, 'OD Bore', '1', 'in', 1.0000, 1.0010, 0.9990, 0.75, 'Bore mic', 'every_n_parts', 1, 0),
        (${companyA!.id}, ${rev!.id}, 'Face Flatness', '2', 'in', 0.0000, 0.0005, NULL, 0.75, 'Indicator', 'sample_size_per_lot', 5, 1),
        (${companyA!.id}, ${rev!.id}, 'Port Depth', '3', 'in', 0.5000, 0.5050, 0.4950, 0.75, 'Depth mic', 'every_n_parts', 2, 2)
    `;
  }

  // Isolation demo part for company B
  await sql`
    INSERT INTO parts (company_id, part_number, description, customer)
    VALUES (${companyB!.id}, 'AX-900', 'Turbine housing', 'Boeing Tier 2')
    ON CONFLICT (company_id, part_number) DO NOTHING
  `;

  // ---------------------------------------------------------------------------
  // QMS Phase 1 demo data (Precision Machine Works)
  // ---------------------------------------------------------------------------

  await sql`
    INSERT INTO number_counters (company_id, prefix, last_value)
    VALUES
      (${companyA!.id}, 'DRW', 1),
      (${companyA!.id}, 'PRO', 1),
      (${companyA!.id}, 'WI', 1),
      (${companyA!.id}, 'FRM', 1),
      (${companyA!.id}, 'CO', 1)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET last_value = GREATEST(number_counters.last_value, EXCLUDED.last_value)
  `;

  const [docDrw] = await sql`
    INSERT INTO documents (company_id, doc_number, doc_type, title, part_id)
    VALUES (
      ${companyA!.id},
      'DRW-0001',
      'drw',
      'Hydraulic manifold body — drawing',
      ${part!.id}
    )
    ON CONFLICT (company_id, doc_number) DO UPDATE
      SET title = EXCLUDED.title, part_id = EXCLUDED.part_id, is_active = true
    RETURNING id
  `;

  const [docPro] = await sql`
    INSERT INTO documents (company_id, doc_number, doc_type, title, part_id)
    VALUES (
      ${companyA!.id},
      'PRO-0001',
      'pro',
      'Manifold machining procedure',
      ${part!.id}
    )
    ON CONFLICT (company_id, doc_number) DO UPDATE
      SET title = EXCLUDED.title, part_id = EXCLUDED.part_id, is_active = true
    RETURNING id
  `;

  const [docWi] = await sql`
    INSERT INTO documents (company_id, doc_number, doc_type, title, part_id)
    VALUES (
      ${companyA!.id},
      'WI-0001',
      'wi',
      'Bore inspection work instruction',
      ${part!.id}
    )
    ON CONFLICT (company_id, doc_number) DO UPDATE
      SET title = EXCLUDED.title, part_id = EXCLUDED.part_id, is_active = true
    RETURNING id
  `;

  const [docFrm] = await sql`
    INSERT INTO documents (company_id, doc_number, doc_type, title, part_id)
    VALUES (
      ${companyA!.id},
      'FRM-0001',
      'frm',
      'First article inspection form',
      NULL
    )
    ON CONFLICT (company_id, doc_number) DO UPDATE
      SET title = EXCLUDED.title, is_active = true
    RETURNING id
  `;

  // Fixed Part 11 content hash placeholder (sha256 of "seed")
  const seedContentSha256 = createHash("sha256")
    .update("seed")
    .digest("hex");

  // Released revisions (pdf_file_id / google_file_id null — no Drive in seed)
  const releasedRevIds: string[] = [];
  for (const [documentId, changeSummary] of [
    [docDrw!.id, "Initial release — Rev A geometry"],
    [docPro!.id, "Initial release — standard process"],
    [docWi!.id, "Initial release — inspection steps"],
    [docFrm!.id, "Initial release — FAI checklist"],
  ] as const) {
    const [docRev] = await sql`
      INSERT INTO document_revisions (
        company_id, document_id, rev, status,
        pdf_file_id, google_file_id, change_summary,
        created_by, released_at, released_by
      )
      VALUES (
        ${companyA!.id},
        ${documentId},
        'A',
        'released',
        NULL,
        NULL,
        ${changeSummary},
        ${quality!.id},
        now(),
        ${quality!.id}
      )
      ON CONFLICT (company_id, document_id, rev) DO UPDATE SET
        status = 'released',
        change_summary = EXCLUDED.change_summary,
        released_at = COALESCE(document_revisions.released_at, now()),
        released_by = COALESCE(document_revisions.released_by, EXCLUDED.released_by)
      RETURNING id
    `;
    if (docRev) releasedRevIds.push(docRev.id as string);
  }

  // ME + QA release signatures (Part 11 shape; segregation: admin ME, quality QA)
  for (const revId of releasedRevIds) {
    await sql`
      INSERT INTO signatures (
        company_id, entity_type, entity_id, meaning,
        signer_id, signer_name, content_sha256, password_verified
      )
      SELECT
        ${companyA!.id}, 'document_revision', ${revId}::uuid, 'me_approval',
        ${admin!.id}, 'Alex Engineer', ${seedContentSha256}, true
      WHERE NOT EXISTS (
        SELECT 1 FROM signatures
        WHERE company_id = ${companyA!.id}
          AND entity_type = 'document_revision'
          AND entity_id = ${revId}::uuid
          AND meaning = 'me_approval'
      )
    `;
    await sql`
      INSERT INTO signatures (
        company_id, entity_type, entity_id, meaning,
        signer_id, signer_name, content_sha256, password_verified
      )
      SELECT
        ${companyA!.id}, 'document_revision', ${revId}::uuid, 'qa_approval',
        ${quality!.id}, 'Quinn Quality', ${seedContentSha256}, true
      WHERE NOT EXISTS (
        SELECT 1 FROM signatures
        WHERE company_id = ${companyA!.id}
          AND entity_type = 'document_revision'
          AND entity_id = ${revId}::uuid
          AND meaning = 'qa_approval'
      )
    `;
  }

  await sql`
    INSERT INTO change_orders (
      company_id, co_number, title, description, reason, status, created_by
    )
    VALUES (
      ${companyA!.id},
      'CO-0001',
      'Update bore tolerance callout',
      'Revise DRW-0001 and WI-0001 to tighten OD Bore USL/LSL callouts and align inspection steps with the new drawing.',
      'Customer ECO from Acme Hydraulics — field failures traced to loose bore stack-up.',
      'draft',
      ${quality!.id}
    )
    ON CONFLICT (company_id, co_number) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      reason = EXCLUDED.reason,
      status = 'draft',
      created_by = EXCLUDED.created_by
  `;

  // ---------------------------------------------------------------------------
  // MES Phase 2–4 demo data
  // ---------------------------------------------------------------------------

  await sql`
    INSERT INTO number_counters (company_id, prefix, last_value)
    VALUES
      (${companyA!.id}, 'WO', 1),
      (${companyA!.id}, 'NC', 1),
      (${companyA!.id}, 'CAPA', 1),
      (${companyA!.id}, 'RTG', 1)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET last_value = GREATEST(number_counters.last_value, EXCLUDED.last_value)
  `;

  let routingId: string;
  {
    const existing = await sql`
      SELECT id FROM routings
      WHERE company_id = ${companyA!.id} AND part_id = ${part!.id}
        AND name = 'RTG-0001 Manifold machine & inspect'
      LIMIT 1
    `;
    if (existing.length > 0) {
      routingId = existing[0]!.id;
    } else {
      const [created] = await sql`
        INSERT INTO routings (company_id, part_id, name, description, created_by)
        VALUES (
          ${companyA!.id},
          ${part!.id},
          'RTG-0001 Manifold machine & inspect',
          'Machine OD bore, face, and inspect per WI-0001',
          ${admin!.id}
        )
        RETURNING id
      `;
      routingId = created!.id;
    }
  }

  const [routingRev] = await sql`
    INSERT INTO routing_revisions (
      company_id, routing_id, rev, status, change_summary,
      created_by, released_at, released_by
    )
    VALUES (
      ${companyA!.id},
      ${routingId},
      'A',
      'released',
      'Initial released routing',
      ${admin!.id},
      now(),
      ${admin!.id}
    )
    ON CONFLICT (company_id, routing_id, rev) DO UPDATE SET
      status = 'released',
      released_at = COALESCE(routing_revisions.released_at, now())
    RETURNING id
  `;

  const existingOps = await sql`
    SELECT id FROM routing_operations
    WHERE company_id = ${companyA!.id} AND routing_revision_id = ${routingRev!.id}
    LIMIT 1
  `;
  if (existingOps.length === 0) {
    await sql`
      INSERT INTO routing_operations (
        company_id, routing_revision_id, op_number, name, work_center,
        wi_document_id, requires_data_sheet
      ) VALUES
        (${companyA!.id}, ${routingRev!.id}, 10, 'CNC mill OD bore', 'CNC-1', NULL, false),
        (${companyA!.id}, ${routingRev!.id}, 20, 'Bore inspection', 'QC-1', ${docWi!.id}, true)
    `;
  }

  const [op10] = await sql`
    SELECT id FROM routing_operations
    WHERE company_id = ${companyA!.id}
      AND routing_revision_id = ${routingRev!.id}
      AND op_number = 10
    LIMIT 1
  `;
  const [op20] = await sql`
    SELECT id FROM routing_operations
    WHERE company_id = ${companyA!.id}
      AND routing_revision_id = ${routingRev!.id}
      AND op_number = 20
    LIMIT 1
  `;

  const [wo] = await sql`
    INSERT INTO work_orders (
      company_id, wo_number, part_id, part_revision_id, routing_revision_id,
      qty, lot_number, status, created_by, released_at, released_by
    )
    VALUES (
      ${companyA!.id},
      'WO-0001',
      ${part!.id},
      ${rev!.id},
      ${routingRev!.id},
      25,
      'LOT-SEED-001',
      'in_progress',
      ${admin!.id},
      now(),
      ${admin!.id}
    )
    ON CONFLICT (company_id, wo_number) DO UPDATE SET
      status = 'in_progress',
      qty = EXCLUDED.qty
    RETURNING id
  `;

  const existingWoo = await sql`
    SELECT id FROM work_order_operations
    WHERE company_id = ${companyA!.id} AND work_order_id = ${wo!.id}
    LIMIT 1
  `;
  let woo10Id: string | undefined;
  let woo20Id: string | undefined;
  if (existingWoo.length === 0 && op10 && op20) {
    const [woo10] = await sql`
      INSERT INTO work_order_operations (
        company_id, work_order_id, routing_operation_id,
        qty_complete, qty_scrap, started_at, started_by, completed_at, completed_by
      ) VALUES (
        ${companyA!.id}, ${wo!.id}, ${op10.id},
        25, 0, now(), ${operator!.id}, now(), ${operator!.id}
      )
      RETURNING id
    `;
    const [woo20] = await sql`
      INSERT INTO work_order_operations (
        company_id, work_order_id, routing_operation_id,
        qty_complete, qty_scrap, started_at, started_by
      ) VALUES (
        ${companyA!.id}, ${wo!.id}, ${op20.id},
        10, 1, now(), ${operator!.id}
      )
      RETURNING id
    `;
    woo10Id = woo10!.id as string;
    woo20Id = woo20!.id as string;

    await sql`
      INSERT INTO operation_executions (
        company_id, work_order_operation_id, qty_good, qty_scrap,
        performed_by, note
      ) VALUES
        (${companyA!.id}, ${woo10Id!}, 25, 0, ${operator!.id}, 'CNC complete'),
        (${companyA!.id}, ${woo20Id!}, 10, 1, ${operator!.id}, 'First inspection batch')
    `;

    const [wiRev] = await sql`
      SELECT id FROM document_revisions
      WHERE company_id = ${companyA!.id}
        AND document_id = ${docWi!.id}
        AND status = 'released'
      LIMIT 1
    `;
    if (wiRev) {
      const snap = JSON.stringify({
        docNumber: "WI-0001",
        title: "Bore inspection work instruction",
        rev: "A",
      });
      await sql`
        INSERT INTO work_order_operation_documents (
          company_id, work_order_operation_id, document_id, document_revision_id,
          role, snapshot
        ) VALUES (
          ${companyA!.id}, ${woo20Id!}, ${docWi!.id}, ${wiRev.id},
          'wi',
          ${snap}::jsonb
        )
      `;
    }
  } else {
    const rows = await sql`
      SELECT woo.id, ro.op_number
      FROM work_order_operations woo
      JOIN routing_operations ro
        ON ro.company_id = woo.company_id AND ro.id = woo.routing_operation_id
      WHERE woo.company_id = ${companyA!.id} AND woo.work_order_id = ${wo!.id}
    `;
    for (const r of rows) {
      if (r.op_number === 10) woo10Id = r.id;
      if (r.op_number === 20) woo20Id = r.id;
    }
  }

  const [nc] = await sql`
    INSERT INTO nonconformances (
      company_id, nc_number, status, title, description,
      part_id, work_order_id, work_order_operation_id,
      flagged_qty, quantity_affected, severity,
      triage_decision, triaged_by, triaged_at,
      disposition, disposition_notes, root_cause, risk_analysis,
      created_by
    )
    VALUES (
      ${companyA!.id},
      'NC-0001',
      'investigation',
      'OD Bore undersize on sample',
      'Operator flagged one piece undersize during op 20 inspection.',
      ${part!.id},
      ${wo!.id},
      ${woo20Id ?? null},
      1,
      1,
      'minor',
      'nc',
      ${admin!.id},
      now(),
      'rework',
      'Rework OD to print and re-inspect.',
      'Tool wear on finish pass',
      'Low risk — contained to lot LOT-SEED-001',
      ${operator!.id}
    )
    ON CONFLICT (company_id, nc_number) DO UPDATE SET
      description = EXCLUDED.description,
      status = EXCLUDED.status
    RETURNING id
  `;

  await sql`
    INSERT INTO nc_events (
      company_id, nonconformance_id, event_type, from_status, to_status,
      actor_id, note
    )
    SELECT
      ${companyA!.id}, ${nc!.id}, 'triage', 'initiation', 'containment',
      ${admin!.id}, 'Triage: proceed as NC (rework)'
    WHERE NOT EXISTS (
      SELECT 1 FROM nc_events
      WHERE company_id = ${companyA!.id} AND nonconformance_id = ${nc!.id}
        AND event_type = 'triage'
    )
  `;

  // Disposition is set on NC-0001 — seed matching disposition signature (quality)
  await sql`
    INSERT INTO signatures (
      company_id, entity_type, entity_id, meaning,
      signer_id, signer_name, content_sha256, password_verified, metadata
    )
    SELECT
      ${companyA!.id}, 'nonconformance', ${nc!.id}::uuid, 'disposition',
      ${quality!.id}, 'Quinn Quality', ${seedContentSha256}, true,
      '{"disposition":"rework"}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM signatures
      WHERE company_id = ${companyA!.id}
        AND entity_type = 'nonconformance'
        AND entity_id = ${nc!.id}::uuid
        AND meaning = 'disposition'
    )
  `;

  await sql`
    INSERT INTO capas (
      company_id, capa_number, nonconformance_id, title, description,
      status, root_cause, corrective_action, preventive_action,
      risk_assessment, created_by, due_at
    )
    VALUES (
      ${companyA!.id},
      'CAPA-0001',
      ${nc!.id},
      'Prevent OD bore undersize from tool wear',
      'Add tool-life check before finish pass on manifold OD bore.',
      'open',
      'Finish tool exceeded recommended cycles',
      'Rework affected piece; replace finish tool',
      'Add tool-cycle counter to op 10 work instruction',
      'Medium — recurrent risk if tool life not tracked',
      ${quality!.id},
      now() + interval '30 days'
    )
    ON CONFLICT (company_id, capa_number) DO UPDATE SET
      description = EXCLUDED.description,
      status = 'open'
  `;

  await sql`RESET ROLE`;
  await sql.end();

  console.log("Seed complete.");
  console.log("  Company A:", companyA!.name, companyA!.id);
  console.log("  Company B:", companyB!.name, companyB!.id);
  console.log(`  Login: admin@precision.local / ${seedPassword}`);
  console.log(`  Login: operator@precision.local / ${seedPassword}`);
  console.log(`  Login: quality@precision.local / ${seedPassword} (quality role)`);
  console.log(`  Login: admin@apex.local / ${seedPassword} (other tenant)`);
  console.log("  QMS docs: DRW-0001, PRO-0001, WI-0001, FRM-0001 (rev A released)");
  console.log("  Change order: CO-0001 (draft)");
  console.log("  Routing: RTG-0001 rev A released; WO-0001 in_progress");
  console.log("  NC-0001 + CAPA-0001 seeded");
  console.log("  Signatures: ME/QA on released revs; disposition on NC-0001");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
