import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Migrations require a superuser (or owner-capable) connection — not datasheets_runtime.
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

  // Ensure API runtime role exists and can only assume datasheets_app (INHERIT FALSE).
  // Never grant datasheets_owner to datasheets_runtime.
  try {
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'datasheets_runtime') THEN
          CREATE ROLE datasheets_runtime
            LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT
            PASSWORD 'datasheets_runtime';
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'datasheets_migrate') THEN
          CREATE ROLE datasheets_migrate NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await sql.unsafe(`
      ALTER ROLE datasheets_runtime WITH NOINHERIT;
      GRANT CONNECT ON DATABASE datasheets TO datasheets_runtime;
      GRANT USAGE ON SCHEMA public TO datasheets_runtime;
      GRANT datasheets_app TO datasheets_runtime WITH INHERIT FALSE;
      GRANT datasheets_owner TO datasheets_migrate;
      REVOKE datasheets_owner FROM datasheets_runtime;
    `);
    console.log(
      "Runtime role ready: datasheets_runtime → datasheets_app (INHERIT FALSE); owner not granted.",
    );
  } catch (e) {
    console.warn("Could not ensure datasheets_runtime role:", e);
  }

  // Do NOT grant datasheets_owner to the connecting user for the API path.
  // Seed/migrate should connect as the container superuser (`datasheets`), which
  // can SET ROLE datasheets_owner without a membership grant. Prefer granting
  // owner only to datasheets_migrate for non-superuser migration tooling.

  await sql.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
