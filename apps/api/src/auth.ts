import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "@datasheets/db";
import { users, sessions, memberships, companies } from "@datasheets/db";

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

export async function createSession(
  db: Db,
  userId: string,
  activeCompanyId: string | null,
  meta?: { ipAddress?: string; userAgent?: string },
) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
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

export async function resolveSession(db: Db, token: string | null | undefined) {
  if (!token) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1);
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) return null;

  let companyId = session.activeCompanyId;
  let role: "operator" | "engineer" | "admin" | null = null;
  let companyName: string | null = null;

  if (companyId) {
    const [m] = await db
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
      const [c] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      companyName = c?.name ?? null;
    }
  }

  // If no active company, pick first membership
  if (!companyId) {
    const [m] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1);
    if (m) {
      companyId = m.companyId;
      role = m.role;
      await db
        .update(sessions)
        .set({ activeCompanyId: companyId, updatedAt: new Date() })
        .where(eq(sessions.id, session.id));
      const [c] = await db
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
}

export type AuthContext = NonNullable<Awaited<ReturnType<typeof resolveSession>>>;
