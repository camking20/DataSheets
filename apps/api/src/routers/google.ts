import {
  getAuthUrl as buildGoogleAuthUrl,
  GoogleEnvError,
} from "@datasheets/google";
import { googleConnections } from "@datasheets/db";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { createOAuthState } from "../google-oauth-http.js";

export const googleRouter = router({
  /**
   * Tenant-visible connection status. Never returns tokens.
   */
  getConnection: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      const [row] = await tx
        .select({
          accountEmail: googleConnections.accountEmail,
          connectedAt: googleConnections.connectedAt,
          encryptedRefreshToken: googleConnections.encryptedRefreshToken,
        })
        .from(googleConnections)
        .where(eq(googleConnections.companyId, ctx.companyId))
        .limit(1);

      const connected = Boolean(row?.encryptedRefreshToken);
      return {
        connected,
        accountEmail: connected ? (row?.accountEmail ?? null) : null,
        connectedAt: connected ? (row?.connectedAt ?? null) : null,
      };
    });
  }),

  /**
   * Admin-only: start Google OAuth. Returns consent URL with short-lived state.
   */
  getAuthUrl: requireRoles("admin").mutation(async ({ ctx }) => {
    try {
      const state = await createOAuthState(ctx.companyId, ctx.auth.user.id);
      const url = buildGoogleAuthUrl(state);
      return { url };
    } catch (err) {
      if (err instanceof GoogleEnvError) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: err.message,
        });
      }
      throw err;
    }
  }),

  /**
   * Admin-only: remove the company's Google connection (tokens deleted).
   */
  disconnect: requireRoles("admin").mutation(async ({ ctx }) => {
    await asTenant(ctx.db, ctx.companyId, async (tx) => {
      await tx
        .delete(googleConnections)
        .where(eq(googleConnections.companyId, ctx.companyId));
    });
    return { ok: true as const };
  }),
});
