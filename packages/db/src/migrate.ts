import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url =
    process.env.DATABASE_URL ??
    "postgresql://datasheets:datasheets@localhost:5432/datasheets";

  console.log("Connecting…");
  const sql = postgres(url, { max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const dir = join(__dirname, "../drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM _migrations WHERE id = ${file}
    `;
    const count = row?.count ?? 0;
    if (count > 0) {
      console.log(`skip  ${file}`);
      continue;
    }
    console.log(`apply ${file}`);
    const body = readFileSync(join(dir, file), "utf8");
    await sql.unsafe(body);
    await sql`INSERT INTO _migrations (id) VALUES (${file})`;
  }

  // Ensure login role can SET ROLE to app / owner for tenancy
  try {
    await sql.unsafe(`
      DO $$
      DECLARE
        current_user_name text := current_user;
      BEGIN
        EXECUTE format('GRANT datasheets_owner TO %I', current_user_name);
        EXECUTE format('GRANT datasheets_app TO %I', current_user_name);
      END $$;
    `);
  } catch (e) {
    console.warn("Could not grant roles to current user:", e);
  }

  await sql.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
