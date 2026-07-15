import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  type DbTx,
  signatures,
} from "@datasheets/db";
import {
  SignatureMeaningSchema,
  type SignatureMeaning,
  requiredSignaturesForDocumentRelease,
} from "@datasheets/core";
import { router, tenantProcedure, asTenant } from "../trpc.js";
import { applySignature } from "../services/signatures.js";
import {
  releaseDocumentRevision,
  implementChangeOrder,
} from "../services/release.js";

/** maybe* helpers no-op when release/implement is not ready or already done. */
function isNotReadyError(err: unknown): boolean {
  return (
    err instanceof TRPCError &&
    (err.code === "BAD_REQUEST" || err.code === "CONFLICT")
  );
}

const ContentSha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "contentSha256 must be a 64-char hex SHA-256");

const EntityTypeSchema = z.enum(["document_revision", "change_order"]);

const CHANGE_ORDER_APPROVALS: readonly SignatureMeaning[] = [
  "change_approval_me",
  "change_approval_qa",
];

function meaningsPresent(
  rows: { meaning: string }[],
  required: readonly SignatureMeaning[],
): boolean {
  const have = new Set(rows.map((r) => r.meaning));
  return required.every((m) => have.has(m));
}

/** Release document revision when ME + QA approvals are both present. */
async function maybeReleaseDocumentRevision(
  tx: DbTx,
  opts: { companyId: string; actorId: string; revisionId: string },
): Promise<void> {
  const sigs = await tx
    .select({ meaning: signatures.meaning })
    .from(signatures)
    .where(
      and(
        eq(signatures.companyId, opts.companyId),
        eq(signatures.entityType, "document_revision"),
        eq(signatures.entityId, opts.revisionId),
      ),
    );

  if (!meaningsPresent(sigs, requiredSignaturesForDocumentRelease())) return;

  try {
    await releaseDocumentRevision(tx, opts);
  } catch (err) {
    if (isNotReadyError(err)) return;
    throw err;
  }
}

/**
 * On both change-order approvals: approve → implement, release linked revisions.
 */
async function maybeImplementChangeOrder(
  tx: DbTx,
  opts: { companyId: string; actorId: string; changeOrderId: string },
): Promise<void> {
  const sigs = await tx
    .select({ meaning: signatures.meaning })
    .from(signatures)
    .where(
      and(
        eq(signatures.companyId, opts.companyId),
        eq(signatures.entityType, "change_order"),
        eq(signatures.entityId, opts.changeOrderId),
      ),
    );

  if (!meaningsPresent(sigs, CHANGE_ORDER_APPROVALS)) return;

  try {
    await implementChangeOrder(tx, opts);
  } catch (err) {
    if (isNotReadyError(err)) return;
    throw err;
  }
}

export const signaturesRouter = router({
  sign: tenantProcedure
    .input(
      z.object({
        entityType: EntityTypeSchema,
        entityId: z.string().uuid(),
        meaning: SignatureMeaningSchema,
        password: z.string().min(1),
        contentSha256: ContentSha256Schema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const row = await applySignature(tx, {
          companyId: ctx.companyId,
          userId: ctx.auth.user.id,
          role: ctx.role,
          entityType: input.entityType,
          entityId: input.entityId,
          meaning: input.meaning,
          password: input.password,
          contentSha256: input.contentSha256?.toLowerCase(),
        });

        if (input.entityType === "document_revision") {
          await maybeReleaseDocumentRevision(tx, {
            companyId: ctx.companyId,
            actorId: ctx.auth.user.id,
            revisionId: input.entityId,
          });
        } else if (input.entityType === "change_order") {
          await maybeImplementChangeOrder(tx, {
            companyId: ctx.companyId,
            actorId: ctx.auth.user.id,
            changeOrderId: input.entityId,
          });
        }

        return row;
      });
    }),

  listForEntity: tenantProcedure
    .input(
      z.object({
        entityType: EntityTypeSchema,
        entityId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        return tx
          .select()
          .from(signatures)
          .where(
            and(
              eq(signatures.companyId, ctx.companyId),
              eq(signatures.entityType, input.entityType),
              eq(signatures.entityId, input.entityId),
            ),
          )
          .orderBy(asc(signatures.signedAt));
      });
    }),
});
