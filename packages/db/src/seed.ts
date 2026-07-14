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

  await sql`
    INSERT INTO memberships (company_id, user_id, role)
    VALUES
      (${companyA!.id}, ${admin!.id}, 'admin'),
      (${companyA!.id}, ${operator!.id}, 'operator'),
      (${companyB!.id}, ${outsider!.id}, 'admin')
    ON CONFLICT (company_id, user_id) DO NOTHING
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

  await sql`
    DELETE FROM dimensions WHERE company_id = ${companyA!.id} AND part_revision_id = ${rev!.id}
  `;

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

  // Isolation demo part for company B
  await sql`
    INSERT INTO parts (company_id, part_number, description, customer)
    VALUES (${companyB!.id}, 'AX-900', 'Turbine housing', 'Boeing Tier 2')
    ON CONFLICT (company_id, part_number) DO NOTHING
  `;

  await sql`RESET ROLE`;
  await sql.end();

  console.log("Seed complete.");
  console.log("  Company A:", companyA!.name, companyA!.id);
  console.log("  Company B:", companyB!.name, companyB!.id);
  console.log(`  Login: admin@precision.local / ${seedPassword}`);
  console.log(`  Login: operator@precision.local / ${seedPassword}`);
  console.log(`  Login: admin@apex.local / ${seedPassword} (other tenant)`);
  // silence unused
  void createHash;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
