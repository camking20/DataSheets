import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

/**
 * API login role (`datasheets_runtime`) is NOINHERIT — it cannot touch tables
 * until it SET ROLE datasheets_app. Use this for auth/session work that has no
 * tenant GUC yet (login, resolveSession, register bootstrap).
 *
 * Optional `userId` sets `app.user_id` so RLS can expose the caller's own
 * memberships/companies before `app.company_id` is known.
 */
export async function asAppRole<T>(
  db: Db,
  fn: (tx: DbTx) => Promise<T>,
  opts?: { userId?: string; companyId?: string },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE datasheets_app`);
    if (opts?.userId) {
      await tx.execute(
        sql`SELECT set_config('app.user_id', ${opts.userId}, true)`,
      );
    }
    if (opts?.companyId) {
      await tx.execute(
        sql`SELECT set_config('app.company_id', ${opts.companyId}, true)`,
      );
    }
    return fn(tx);
  });
}

/**
 * Run work inside a transaction as datasheets_app with RLS tenant context set.
 * Uses SET LOCAL so role + setting are scoped to the transaction only.
 */
export async function withTenant<T>(
  db: Db,
  companyId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE datasheets_app`);
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Privileged path for migrations / seed only — SET LOCAL ROLE datasheets_owner (BYPASSRLS).
 *
 * NEVER call this from the API. The API connects as `datasheets_runtime`, which is
 * granted only `datasheets_app` (INHERIT FALSE) and cannot assume `datasheets_owner`.
 * Auth register and all request handlers must use `datasheets_app` (e.g. asTenant),
 * never datasheets_owner.
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
