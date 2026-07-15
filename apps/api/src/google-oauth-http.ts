import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import {
  exchangeCode,
  encryptRefreshToken,
  clientFromRefreshToken,
  provisionCompanyDrive,
} from "@datasheets/google";
import { asAppRole, companies, googleConnections, oauthStates } from "@datasheets/db";
import { asTenant, db } from "./trpc.js";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Create a short-lived state nonce bound to company + user (DB-backed). */
export async function createOAuthState(
  companyId: string,
  userId: string,
): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  await asAppRole(db, async (tx) => {
    // Best-effort prune of expired rows (keeps table small).
    await tx
      .delete(oauthStates)
      .where(lt(oauthStates.expiresAt, new Date()));

    await tx.insert(oauthStates).values({
      state,
      companyId,
      userId,
      expiresAt,
    });
  });

  return state;
}

/** Consume (one-time) OAuth state. Returns null if missing or expired. */
export async function consumeOAuthState(
  state: string,
): Promise<{ companyId: string; userId: string } | null> {
  return asAppRole(db, async (tx) => {
    const [entry] = await tx
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, state))
      .limit(1);

    if (!entry) return null;

    await tx.delete(oauthStates).where(eq(oauthStates.id, entry.id));

    if (entry.expiresAt.getTime() <= Date.now()) return null;

    return { companyId: entry.companyId, userId: entry.userId };
  });
}

function webIntegrationsUrl(params: Record<string, string>): string {
  const base = (process.env.WEB_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const qs = new URLSearchParams(params);
  return `${base}/settings/integrations?${qs.toString()}`;
}

function redirectError(reply: FastifyReply, reason: string): void {
  void reply.redirect(webIntegrationsUrl({ google: "error", reason }));
}

/** Resolve Google account email via Drive about (works with drive.* scopes). */
async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  const url = new URL("https://www.googleapis.com/drive/v3/about");
  url.searchParams.set("fields", "user(emailAddress)");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    user?: { emailAddress?: string | null };
  };
  return body.user?.emailAddress ?? null;
}

function readCallbackParams(
  req: FastifyRequest,
): { code?: string; state?: string; error?: string } {
  const query = req.query as Record<string, unknown>;
  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};

  const pick = (key: string): string | undefined => {
    const fromQuery = query[key];
    if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;
    const fromBody = body[key];
    if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;
    return undefined;
  };

  return {
    code: pick("code"),
    state: pick("state"),
    error: pick("error"),
  };
}

async function handleOAuthCallback(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { code, state, error } = readCallbackParams(req);

  if (error) {
    redirectError(reply, "access_denied");
    return;
  }
  if (!code || !state) {
    redirectError(reply, "missing_params");
    return;
  }

  const consumed = await consumeOAuthState(state);
  if (!consumed) {
    redirectError(reply, "invalid_state");
    return;
  }

  const { companyId, userId } = consumed;

  try {
    let tokens;
    try {
      tokens = await exchangeCode(code);
    } catch (err) {
      req.log.error({ err }, "Google token exchange failed");
      const detail = googleErrorDetail(err);
      redirectError(
        reply,
        detail.includes("redirect_uri")
          ? "redirect_uri_mismatch"
          : detail.includes("invalid_client")
            ? "invalid_client"
            : "token_exchange",
      );
      return;
    }

    let encryptedRefreshToken: string;
    try {
      encryptedRefreshToken = encryptRefreshToken(tokens.refreshToken);
    } catch (err) {
      req.log.error({ err }, "Google refresh token encryption failed");
      redirectError(reply, "encrypt_failed");
      return;
    }

    const accountEmail = await fetchGoogleAccountEmail(tokens.accessToken);
    const authClient = clientFromRefreshToken(encryptedRefreshToken);

    try {
      // Resolve company name in a short txn; provision Drive outside the txn.
      const company = await asTenant(db, companyId, async (tx) => {
        const [row] = await tx
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        return row ?? null;
      });

      if (!company) {
        redirectError(reply, "company_not_found");
        return;
      }

      const provisioned = await provisionCompanyDrive(authClient, company.name);
      const now = new Date();

      await asTenant(db, companyId, async (tx) => {
        await tx
          .insert(googleConnections)
          .values({
            companyId,
            encryptedRefreshToken,
            accountEmail,
            rootFolderId: provisioned.rootFolderId,
            folders: provisioned.folders,
            connectedBy: userId,
            connectedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: googleConnections.companyId,
            set: {
              encryptedRefreshToken,
              accountEmail,
              rootFolderId: provisioned.rootFolderId,
              folders: provisioned.folders,
              connectedBy: userId,
              connectedAt: now,
              updatedAt: now,
            },
          });
      });
    } catch (err) {
      req.log.error({ err }, "Google Drive provision / save failed");
      if (err instanceof Error && err.message === "company_not_found") {
        redirectError(reply, "company_not_found");
        return;
      }
      const detail = googleErrorDetail(err);
      if (
        /accessNotConfigured|has not been used|disabled|Drive API/i.test(detail)
      ) {
        redirectError(reply, "drive_api_disabled");
        return;
      }
      redirectError(reply, "provision_failed");
      return;
    }

    void reply.redirect(webIntegrationsUrl({ google: "connected" }));
  } catch (err) {
    req.log.error({ err }, "Google OAuth callback failed");
    redirectError(reply, "exchange_failed");
  }
}

/** Pull a useful string out of googleapis / gaxios errors. */
function googleErrorDetail(err: unknown): string {
  if (!err || typeof err !== "object") return String(err ?? "");
  const anyErr = err as {
    message?: string;
    response?: { data?: { error?: string | { message?: string; status?: string } } };
  };
  const data = anyErr.response?.data?.error;
  if (typeof data === "string") return `${anyErr.message ?? ""} ${data}`;
  if (data && typeof data === "object") {
    return `${anyErr.message ?? ""} ${data.status ?? ""} ${data.message ?? ""}`;
  }
  return anyErr.message ?? String(err);
}

/**
 * Register Google OAuth HTTP callback routes on the Fastify app.
 * Call once from index.ts — do not register tRPC procedures here.
 */
export async function registerGoogleOAuthRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/google/oauth/callback", handleOAuthCallback);
  fastify.post("/google/oauth/callback", handleOAuthCallback);
}
