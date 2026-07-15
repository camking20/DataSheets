import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  type DbTx,
  users,
  signatures,
  auditLogs,
  documentRevisions,
  files,
  changeOrders,
  changeOrderItems,
  nonconformances,
  capas,
  capaActions,
  type Signature,
} from "@datasheets/db";
import {
  type MembershipRole,
  type SignatureMeaning,
  canSignMeaning,
  assertSegregationOfDuties,
} from "@datasheets/core";
import {
  hashDocumentRevisionContent,
  hashChangeOrderContent,
  hashNcContent,
  hashCapaContent,
} from "@datasheets/core/hashing";
import { verifyPassword } from "../auth.js";

export type ApplySignatureInput = {
  companyId: string;
  userId: string;
  role: MembershipRole;
  entityType: string;
  entityId: string;
  meaning: SignatureMeaning;
  password: string;
  /** Optional client preview hash; if present must match server-computed content hash. */
  contentSha256?: string;
  metadata?: Record<string, unknown>;
};

const CONTENT_MISMATCH_MESSAGE =
  "Content changed since you reviewed — refresh and sign again";

function assertMeaningForEntityType(
  entityType: string,
  meaning: SignatureMeaning,
): void {
  const ok =
    (entityType === "document_revision" &&
      (meaning === "me_approval" || meaning === "qa_approval")) ||
    (entityType === "change_order" &&
      (meaning === "change_approval_me" ||
        meaning === "change_approval_qa")) ||
    (entityType === "nonconformance" &&
      (meaning === "disposition" || meaning === "closure")) ||
    (entityType === "capa" && meaning === "closure");

  if (!ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Meaning ${meaning} is not valid for entity type ${entityType}`,
    });
  }
}

async function computeServerContentSha256(
  tx: DbTx,
  input: Pick<
    ApplySignatureInput,
    "companyId" | "entityType" | "entityId" | "meaning"
  >,
): Promise<string> {
  const { companyId, entityType, entityId, meaning } = input;

  if (entityType === "document_revision") {
    const [rev] = await tx
      .select()
      .from(documentRevisions)
      .where(
        and(
          eq(documentRevisions.companyId, companyId),
          eq(documentRevisions.id, entityId),
        ),
      )
      .limit(1);

    if (!rev) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Document revision not found",
      });
    }
    if (rev.status !== "in_review") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Document revision must be in_review to sign (got ${rev.status})`,
      });
    }
    if (!rev.pdfFileId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Document revision has no PDF to bind the signature to",
      });
    }

    const [pdf] = await tx
      .select()
      .from(files)
      .where(and(eq(files.companyId, companyId), eq(files.id, rev.pdfFileId)))
      .limit(1);

    if (!pdf?.sha256) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "PDF file digest not found for document revision",
      });
    }

    try {
      return hashDocumentRevisionContent(pdf.sha256);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          err instanceof Error ? err.message : "Invalid PDF content digest",
      });
    }
  }

  if (entityType === "change_order") {
    const [co] = await tx
      .select()
      .from(changeOrders)
      .where(
        and(eq(changeOrders.companyId, companyId), eq(changeOrders.id, entityId)),
      )
      .limit(1);

    if (!co) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Change order not found",
      });
    }
    if (co.status !== "in_review") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Change order must be in_review to sign (got ${co.status})`,
      });
    }

    const items = await tx
      .select()
      .from(changeOrderItems)
      .where(
        and(
          eq(changeOrderItems.companyId, companyId),
          eq(changeOrderItems.changeOrderId, co.id),
        ),
      );

    const itemRevisionIds = items.flatMap((item) => {
      const ids: string[] = [];
      if (item.documentRevisionId) ids.push(item.documentRevisionId);
      if (item.routingRevisionId) ids.push(item.routingRevisionId);
      return ids;
    });

    return hashChangeOrderContent({
      id: co.id,
      coNumber: co.coNumber,
      title: co.title,
      description: co.description,
      reason: co.reason,
      status: co.status,
      itemRevisionIds,
    });
  }

  if (entityType === "nonconformance") {
    const [nc] = await tx
      .select()
      .from(nonconformances)
      .where(
        and(
          eq(nonconformances.companyId, companyId),
          eq(nonconformances.id, entityId),
        ),
      )
      .limit(1);

    if (!nc) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Nonconformance not found",
      });
    }

    if (meaning === "disposition") {
      if (
        nc.status !== "disposition_planning" &&
        nc.status !== "initiation"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `NC disposition requires status disposition_planning or initiation (got ${nc.status})`,
        });
      }
    } else if (meaning === "closure") {
      if (nc.status !== "investigation") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `NC closure requires status investigation (got ${nc.status})`,
        });
      }
    }

    return hashNcContent({
      id: nc.id,
      ncNumber: nc.ncNumber,
      status: nc.status,
      title: nc.title,
      description: nc.description,
      disposition: nc.disposition,
      dispositionNotes: nc.dispositionNotes,
      rootCause: nc.rootCause,
      containmentActions: nc.containmentActions,
      riskAnalysis: nc.riskAnalysis,
      quantityAffected: nc.quantityAffected,
    });
  }

  if (entityType === "capa") {
    const [capa] = await tx
      .select()
      .from(capas)
      .where(and(eq(capas.companyId, companyId), eq(capas.id, entityId)))
      .limit(1);

    if (!capa) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "CAPA not found",
      });
    }

    if (capa.status !== "verification") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `CAPA closure requires status verification (got ${capa.status})`,
      });
    }

    const actions = await tx
      .select()
      .from(capaActions)
      .where(
        and(
          eq(capaActions.companyId, companyId),
          eq(capaActions.capaId, capa.id),
        ),
      );

    return hashCapaContent({
      id: capa.id,
      capaNumber: capa.capaNumber,
      status: capa.status,
      title: capa.title,
      description: capa.description,
      rootCause: capa.rootCause,
      correctiveAction: capa.correctiveAction,
      preventiveAction: capa.preventiveAction,
      effectivenessCheck: capa.effectivenessCheck,
      actionSummaries: actions.map((a) => a.description),
    });
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Unsupported signature entity type: ${entityType}`,
  });
}

/**
 * Part 11 e-signature: re-auth, role gate, segregation of duties,
 * server-side content binding, immutable insert + audit.
 * Caller must already be inside a tenant transaction (`asTenant`).
 */
export async function applySignature(
  tx: DbTx,
  input: ApplySignatureInput,
): Promise<Signature> {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (
    !user?.passwordHash ||
    !verifyPassword(input.password, user.passwordHash)
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid password",
    });
  }

  if (!canSignMeaning(input.role, input.meaning)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Role ${input.role} cannot sign meaning ${input.meaning}`,
    });
  }

  assertMeaningForEntityType(input.entityType, input.meaning);

  const contentSha256 = await computeServerContentSha256(tx, input);

  if (input.contentSha256 !== undefined) {
    const clientHash = input.contentSha256.trim().toLowerCase();
    if (clientHash !== contentSha256) {
      throw new TRPCError({
        code: "CONFLICT",
        message: CONTENT_MISMATCH_MESSAGE,
      });
    }
  }

  const existing = await tx
    .select()
    .from(signatures)
    .where(
      and(
        eq(signatures.companyId, input.companyId),
        eq(signatures.entityType, input.entityType),
        eq(signatures.entityId, input.entityId),
      ),
    );

  if (existing.some((s) => s.meaning === input.meaning)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Meaning ${input.meaning} already signed for this entity`,
    });
  }

  try {
    assertSegregationOfDuties(
      existing.map((s) => s.meaning as SignatureMeaning),
      input.meaning,
      input.userId,
      existing.map((s) => s.signerId ?? ""),
    );
  } catch (err) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        err instanceof Error ? err.message : "Segregation of duties violation",
    });
  }

  const [row] = await tx
    .insert(signatures)
    .values({
      companyId: input.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      meaning: input.meaning,
      signerId: input.userId,
      signerName: user.name,
      contentSha256,
      passwordVerified: true,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!row) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to insert signature",
    });
  }

  await tx.insert(auditLogs).values({
    companyId: input.companyId,
    actorId: input.userId,
    action: "signature.apply",
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: {
      signatureId: row.id,
      meaning: input.meaning,
      contentSha256,
    },
  });

  return row;
}
