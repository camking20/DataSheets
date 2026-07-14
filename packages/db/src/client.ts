import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

/**
 * Run work inside a transaction with RLS tenant context set.
 * Uses SET LOCAL so the setting is scoped to the transaction only.
 */
export async function withTenant<T>(
  db: Db,
  companyId: string,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Privileged connection for migrations / seeding (bypasses RLS via table owner).
 * Application runtime MUST use the `datasheets_app` role which has NO BYPASSRLS.
 */
export async function withBypassRls<T>(
  db: Db,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE datasheets_owner`);
    return fn(tx);
  });
}

export * from "./schema.js";
