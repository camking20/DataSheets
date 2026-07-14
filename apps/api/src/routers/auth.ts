import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  users,
  companies,
  memberships,
  sessions,
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
} from "../auth.js";

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
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
      const existing = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);
      if (existing[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "Email in use" });
      }

      const [user] = await ctx.db
        .insert(users)
        .values({
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: hashPassword(input.password),
          emailVerified: true,
        })
        .returning();

      const [company] = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE datasheets_owner`);
        const [c] = await tx
          .insert(companies)
          .values({
            name: input.companyName,
            slug: input.companySlug,
            settings: { defaultWarningFraction: 0.75, defaultUnit: "in" },
          })
          .returning();
        await tx.insert(memberships).values({
          companyId: c!.id,
          userId: user!.id,
          role: "admin",
        });
        return [c!];
      });

      const session = await createSession(ctx.db, user!.id, company!.id);
      return {
        token: session.token,
        user: { id: user!.id, email: user!.email, name: user!.name },
        company: { id: company!.id, name: company!.name, slug: company!.slug },
      };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);
      if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, user.id))
        .limit(1);

      const session = await createSession(
        ctx.db,
        user.id,
        membership?.companyId ?? null,
      );

      let company = null;
      if (membership) {
        const [c] = await ctx.db
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
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const userMemberships = await ctx.db
      .select({
        companyId: memberships.companyId,
        role: memberships.role,
        companyName: companies.name,
        companySlug: companies.slug,
      })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.companyId))
      .where(eq(memberships.userId, ctx.auth.user.id));

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
      const [m] = await ctx.db
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
      await ctx.db
        .update(sessions)
        .set({ activeCompanyId: input.companyId, updatedAt: new Date() })
        .where(eq(sessions.id, ctx.auth.session.id));
      return { companyId: input.companyId, role: m.role };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(sessions).where(eq(sessions.id, ctx.auth.session.id));
    return { ok: true };
  }),
});
