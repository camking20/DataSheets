import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@datasheets/db";
import { resolveSession, type AuthContext } from "./auth.js";
import type { MembershipRole } from "@datasheets/core";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://datasheets:datasheets@localhost:5432/datasheets";

export const { db, client: pgClient } = createDb(connectionString);

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  const header = req.headers.authorization;
  const token =
    (typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : null) ??
    (typeof req.headers["x-session-token"] === "string"
      ? req.headers["x-session-token"]
      : null);

  const auth = await resolveSession(db, token);

  return { db, req, res, auth };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, auth: ctx.auth as AuthContext },
  });
});

export const tenantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.auth.companyId || !ctx.auth.role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No active company membership",
    });
  }
  return next({
    ctx: {
      ...ctx,
      companyId: ctx.auth.companyId,
      role: ctx.auth.role as MembershipRole,
    },
  });
});

export function requireRoles(...roles: MembershipRole[]) {
  return tenantProcedure.use(({ ctx, next }) => {
    if (!roles.includes(ctx.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires role: ${roles.join(" | ")}`,
      });
    }
    return next({ ctx });
  });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run work as datasheets_app with SET LOCAL app.company_id.
 * companyId ALWAYS comes from the authenticated session — never client input.
 */
export async function asTenant<T>(
  database: Db,
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE datasheets_app`);
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`,
    );
    return fn(tx);
  });
}
