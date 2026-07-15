import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  asAppRole,
  type Db,
  type DbTx,
  users,
  sessions,
  memberships,
  companies,
} from "@datasheets/db";

/** Session lifetime — shortened from 30d for stolen-token mitigation. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Email verification token lifetime. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

type Queryable = Db | DbTx;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split(":");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function newSessionToken(): string {
  return createHash("sha256").update(randomBytes(48)).digest("hex");
}

export function newEmailVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

/** Invalidate all sessions for a user (single-session / stolen-token mitigation). */
export async function invalidateUserSessions(db: Queryable, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function createSession(
  db: Queryable,
  userId: string,
  activeCompanyId: string | null,
  meta?: { ipAddress?: string; userAgent?: string },
) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      token,
      expiresAt,
      activeCompanyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    })
    .returning();
  return row!;
}

/**
 * Resolve bearer token → user + company. Always runs as datasheets_app
 * (runtime login role is NOINHERIT and has no direct table grants).
 */
export async function resolveSession(db: Db, token: string | null | undefined) {
  if (!token) return null;

  return asAppRole(db, async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1);
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user) return null;
    // Unverified accounts must not use sessions issued before verification.
    if (!user.emailVerified) return null;

    // Enable membership/company reads for this user (RLS) before company GUC exists.
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${user.id}, true)`,
    );

    let companyId = session.activeCompanyId;
    let role: "operator" | "engineer" | "admin" | "quality" | null = null;
    let companyName: string | null = null;

    if (companyId) {
      await tx.execute(
        sql`SELECT set_config('app.company_id', ${companyId}, true)`,
      );
      const [m] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.companyId, companyId),
          ),
        )
        .limit(1);
      if (!m) {
        companyId = null;
      } else {
        role = m.role;
        const [c] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        companyName = c?.name ?? null;
      }
    }

    // If no active company, pick first membership
    if (!companyId) {
      const [m] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.userId, user.id))
        .limit(1);
      if (m) {
        companyId = m.companyId;
        role = m.role;
        await tx.execute(
          sql`SELECT set_config('app.company_id', ${companyId}, true)`,
        );
        await tx
          .update(sessions)
          .set({ activeCompanyId: companyId, updatedAt: new Date() })
          .where(eq(sessions.id, session.id));
        const [c] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        companyName = c?.name ?? null;
      }
    }

    return {
      session,
      user: { id: user.id, email: user.email, name: user.name },
      companyId,
      companyName,
      role,
    };
  });
}

export type AuthContext = NonNullable<Awaited<ReturnType<typeof resolveSession>>>;
