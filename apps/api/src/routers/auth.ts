import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  asAppRole,
  users,
  companies,
  memberships,
  sessions,
  type DbTx,
} from "@datasheets/db";
import {
  publicProcedure,
  protectedProcedure,
  router,
} from "../trpc.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  invalidateUserSessions,
  newEmailVerificationToken,
  EMAIL_VERIFICATION_TTL_MS,
} from "../auth.js";
import {
  assertRateLimit,
  AUTH_RATE_LIMITS,
  RATE_LIMIT_WINDOW_MS,
} from "../rate-limit.js";

function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip ?? "unknown";
}

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
};

/**
 * Creates company + admin membership via SECURITY DEFINER function.
 * Caller must already be running as datasheets_app (asAppRole).
 */
async function createCompanyWithOwner(
  tx: DbTx,
  input: {
    name: string;
    slug: string;
    settings: { defaultWarningFraction: number; defaultUnit: string };
    userId: string;
  },
): Promise<CompanyRow> {
  const rows = await tx.execute(sql`
    SELECT id, name, slug
    FROM create_company_with_owner(
      ${input.name},
      ${input.slug},
      ${JSON.stringify(input.settings)}::jsonb,
      ${input.userId}::uuid,
      'admin'::membership_role
    )
  `);
  const row = (rows as unknown as CompanyRow[])[0];
  if (!row?.id) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create company",
    });
  }
  return row;
}

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(12),
        name: z.string().min(1),
        companyName: z.string().min(1),
        companySlug: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9-]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req);
      assertRateLimit(
        `register:ip:${ip}`,
        AUTH_RATE_LIMITS.registerPerIp,
        RATE_LIMIT_WINDOW_MS,
      );

      const email = input.email.toLowerCase();
      const verificationToken = newEmailVerificationToken();
      const verificationExpires = new Date(
        Date.now() + EMAIL_VERIFICATION_TTL_MS,
      );

      return asAppRole(ctx.db, async (tx) => {
        const existing = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existing[0]) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Unable to create account. If you already have an account, sign in.",
          });
        }

        let user: typeof users.$inferSelect;
        try {
          const [inserted] = await tx
            .insert(users)
            .values({
              email,
              name: input.name,
              passwordHash: hashPassword(input.password),
              emailVerified: false,
              emailVerificationToken: verificationToken,
              emailVerificationExpires: verificationExpires,
            })
            .returning();
          user = inserted!;
        } catch {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Unable to create account. If you already have an account, sign in.",
          });
        }

        let company: CompanyRow;
        try {
          company = await createCompanyWithOwner(tx, {
            name: input.companyName,
            slug: input.companySlug,
            settings: { defaultWarningFraction: 0.75, defaultUnit: "in" },
            userId: user.id,
          });
        } catch (err) {
          await tx.delete(users).where(eq(users.id, user.id));
          const message =
            err instanceof Error ? err.message : "Unable to create account";
          if (/unique|duplicate|slug/i.test(message)) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Unable to create account. If you already have an account, sign in.",
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to create account",
          });
        }

        return {
          user: { id: user.id, email: user.email, name: user.name },
          company: { id: company.id, name: company.name, slug: company.slug },
          emailVerificationRequired: true,
          ...(process.env.NODE_ENV !== "production"
            ? { devVerificationToken: verificationToken }
            : {}),
        };
      });
    }),

  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return asAppRole(ctx.db, async (tx) => {
        const [row] = await tx
          .update(users)
          .set({
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(users.emailVerificationToken, input.token),
              sql`${users.emailVerificationExpires} > now()`,
            ),
          )
          .returning({ id: users.id });
        if (!row?.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired verification token",
          });
        }
        return { ok: true as const };
      });
    }),

  /**
   * Dev-only: mark email verified without a token.
   * Disabled when NODE_ENV === 'production'.
   */
  devVerifyEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (process.env.NODE_ENV === "production") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const email = input.email.toLowerCase();
      return asAppRole(ctx.db, async (tx) => {
        const [user] = await tx
          .update(users)
          .set({
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null,
            updatedAt: new Date(),
          })
          .where(eq(users.email, email))
          .returning({ id: users.id });
        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }
        return { ok: true as const };
      });
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req);
      const email = input.email.toLowerCase();
      assertRateLimit(
        `login:ip:${ip}`,
        AUTH_RATE_LIMITS.loginPerIp,
        RATE_LIMIT_WINDOW_MS,
      );
      assertRateLimit(
        `login:email:${email}`,
        AUTH_RATE_LIMITS.loginPerEmail,
        RATE_LIMIT_WINDOW_MS,
      );

      return asAppRole(ctx.db, async (tx) => {
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (
          !user?.passwordHash ||
          !verifyPassword(input.password, user.passwordHash)
        ) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid credentials",
          });
        }

        if (!user.emailVerified) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Verify your email before signing in.",
          });
        }

        // RLS: allow reading this user's memberships before company GUC is set
        await tx.execute(
          sql`SELECT set_config('app.user_id', ${user.id}, true)`,
        );

        const [membership] = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.userId, user.id))
          .limit(1);

        await invalidateUserSessions(tx, user.id);

        const session = await createSession(
          tx,
          user.id,
          membership?.companyId ?? null,
          {
            ipAddress: ip,
            userAgent:
              typeof ctx.req.headers["user-agent"] === "string"
                ? ctx.req.headers["user-agent"]
                : undefined,
          },
        );

        let company = null;
        if (membership) {
          const [c] = await tx
            .select()
            .from(companies)
            .where(eq(companies.id, membership.companyId))
            .limit(1);
          company = c
            ? { id: c.id, name: c.name, slug: c.slug, role: membership.role }
            : null;
        }

        return {
          token: session.token,
          user: { id: user.id, email: user.email, name: user.name },
          company,
        };
      });
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const userMemberships = await asAppRole(
      ctx.db,
      async (tx) =>
        tx
          .select({
            companyId: memberships.companyId,
            role: memberships.role,
            companyName: companies.name,
            companySlug: companies.slug,
          })
          .from(memberships)
          .innerJoin(companies, eq(companies.id, memberships.companyId))
          .where(eq(memberships.userId, ctx.auth.user.id)),
      { userId: ctx.auth.user.id },
    );

    return {
      user: ctx.auth.user,
      companyId: ctx.auth.companyId,
      companyName: ctx.auth.companyName,
      role: ctx.auth.role,
      memberships: userMemberships,
    };
  }),

  switchCompany: protectedProcedure
    .input(z.object({ companyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asAppRole(
        ctx.db,
        async (tx) => {
          const [m] = await tx
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.userId, ctx.auth.user.id),
                eq(memberships.companyId, input.companyId),
              ),
            )
            .limit(1);
          if (!m) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Not a member of that company",
            });
          }
          await tx
            .update(sessions)
            .set({ activeCompanyId: input.companyId, updatedAt: new Date() })
            .where(eq(sessions.id, ctx.auth.session.id));
          return { companyId: input.companyId, role: m.role };
        },
        { userId: ctx.auth.user.id, companyId: input.companyId },
      );
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await asAppRole(ctx.db, async (tx) => {
      await tx.delete(sessions).where(eq(sessions.id, ctx.auth.session.id));
    });
    return { ok: true };
  }),
});
