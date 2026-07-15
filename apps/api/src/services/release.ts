import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  type DbTx,
  type DocumentRevision,
  type ChangeOrder,
  documentRevisions,
  routingRevisions,
  changeOrders,
  changeOrderItems,
  signatures,
  auditLogs,
} from "@datasheets/db";
import {
  requiredSignaturesForDocumentRelease,
  canTransitionChangeOrder,
  assertDocumentRevisionTransition,
  type SignatureMeaning,
} from "@datasheets/core";

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

/** Core release: supersede prior released revs, mark this one released, audit. */
async function supersedeAndReleaseRevision(
  tx: DbTx,
  opts: {
    companyId: string;
    actorId: string;
    rev: DocumentRevision;
    now: Date;
    via: string;
  },
): Promise<DocumentRevision> {
  const { companyId, actorId, rev, now, via } = opts;

  assertDocumentRevisionTransition("in_review", "released");

  await tx
    .update(documentRevisions)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(documentRevisions.companyId, companyId),
        eq(documentRevisions.documentId, rev.documentId),
        eq(documentRevisions.status, "released"),
      ),
    );

  const [updated] = await tx
    .update(documentRevisions)
    .set({
      status: "released",
      releasedAt: now,
      releasedBy: actorId,
      updatedAt: now,
    })
    .where(
      and(
        eq(documentRevisions.companyId, companyId),
        eq(documentRevisions.id, rev.id),
        eq(documentRevisions.status, "in_review"),
      ),
    )
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Document revision could not be released",
    });
  }

  await tx.insert(auditLogs).values({
    companyId,
    actorId,
    action: "document_revision.release",
    entityType: "document_revision",
    entityId: rev.id,
    metadata: {
      documentId: rev.documentId,
      rev: rev.rev,
      via,
    },
  });

  return updated;
}

/**
 * Release an in_review document revision when ME + QA signatures are present.
 * Locks the revision row (FOR UPDATE), supersedes other released revs for the
 * same document, sets released, and writes an audit log.
 */
export async function releaseDocumentRevision(
  tx: DbTx,
  opts: {
    companyId: string;
    actorId: string;
    revisionId: string;
  },
): Promise<DocumentRevision> {
  const { companyId, actorId, revisionId } = opts;

  const [rev] = await tx
    .select()
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.companyId, companyId),
        eq(documentRevisions.id, revisionId),
      ),
    )
    .limit(1)
    .for("update");

  if (!rev) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Document revision not found",
    });
  }

  if (rev.status !== "in_review") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Document revision must be in_review to release (got ${rev.status})`,
    });
  }

  const sigs = await tx
    .select({ meaning: signatures.meaning })
    .from(signatures)
    .where(
      and(
        eq(signatures.companyId, companyId),
        eq(signatures.entityType, "document_revision"),
        eq(signatures.entityId, rev.id),
      ),
    );

  if (!meaningsPresent(sigs, requiredSignaturesForDocumentRelease())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Both ME and QA signatures are required before release",
    });
  }

  return supersedeAndReleaseRevision(tx, {
    companyId,
    actorId,
    rev,
    now: new Date(),
    via: "releaseDocumentRevision",
  });
}

/**
 * After change_approval_me + change_approval_qa are present: release linked
 * document/routing revisions and mark the change order implemented.
 */
export async function implementChangeOrder(
  tx: DbTx,
  opts: {
    companyId: string;
    actorId: string;
    changeOrderId: string;
  },
): Promise<ChangeOrder> {
  const { companyId, actorId, changeOrderId } = opts;
  const now = new Date();

  const [co] = await tx
    .select()
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.companyId, companyId),
        eq(changeOrders.id, changeOrderId),
      ),
    )
    .limit(1)
    .for("update");

  if (!co) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Change order not found",
    });
  }

  if (co.status === "implemented") {
    return co;
  }

  if (co.status !== "in_review" && co.status !== "approved") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Change order cannot be implemented from status ${co.status}`,
    });
  }

  const coSignatures = await tx
    .select({ meaning: signatures.meaning })
    .from(signatures)
    .where(
      and(
        eq(signatures.companyId, companyId),
        eq(signatures.entityType, "change_order"),
        eq(signatures.entityId, co.id),
      ),
    );

  if (!meaningsPresent(coSignatures, CHANGE_ORDER_APPROVALS)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Both change_approval_me and change_approval_qa signatures are required",
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

  if (items.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Change order has no items to release",
    });
  }

  const releasedRevisionIds: string[] = [];
  const releasedRoutingRevisionIds: string[] = [];

  for (const item of items) {
    if (item.documentRevisionId) {
      const [rev] = await tx
        .select()
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.companyId, companyId),
            eq(documentRevisions.id, item.documentRevisionId),
          ),
        )
        .limit(1)
        .for("update");

      if (!rev) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more document revisions were not found",
        });
      }

      if (rev.status === "released") {
        releasedRevisionIds.push(rev.id);
        continue;
      }

      if (rev.status !== "in_review") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Revision ${rev.rev} must be in_review to release (got ${rev.status})`,
        });
      }

      // CO approvals gate release — same supersede/release path as
      // releaseDocumentRevision, without per-revision ME/QA signatures.
      const released = await supersedeAndReleaseRevision(tx, {
        companyId,
        actorId,
        rev,
        now,
        via: "change_order.implement",
      });
      releasedRevisionIds.push(released.id);
      continue;
    }

    if (item.routingRevisionId) {
      const [rev] = await tx
        .select()
        .from(routingRevisions)
        .where(
          and(
            eq(routingRevisions.companyId, companyId),
            eq(routingRevisions.id, item.routingRevisionId),
          ),
        )
        .limit(1)
        .for("update");

      if (!rev) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more routing revisions were not found",
        });
      }

      if (rev.status === "released") {
        releasedRoutingRevisionIds.push(rev.id);
        continue;
      }

      if (rev.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Routing revision ${rev.rev} must be draft to release (got ${rev.status})`,
        });
      }

      await tx
        .update(routingRevisions)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(routingRevisions.companyId, companyId),
            eq(routingRevisions.routingId, rev.routingId),
            eq(routingRevisions.status, "released"),
          ),
        );

      const [released] = await tx
        .update(routingRevisions)
        .set({
          status: "released",
          releasedAt: now,
          releasedBy: actorId,
          updatedAt: now,
        })
        .where(
          and(
            eq(routingRevisions.companyId, companyId),
            eq(routingRevisions.id, rev.id),
            eq(routingRevisions.status, "draft"),
          ),
        )
        .returning();

      if (!released) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Routing revision ${rev.rev} could not be released`,
        });
      }
      releasedRoutingRevisionIds.push(released.id);
      continue;
    }

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Change order item has neither document nor routing revision",
    });
  }

  // in_review → approved → implemented (set approvedAt / implementedAt).
  let working = co;
  if (working.status === "in_review") {
    if (!canTransitionChangeOrder("in_review", "approved")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid transition in_review → approved",
      });
    }
    const [approved] = await tx
      .update(changeOrders)
      .set({
        status: "approved",
        approvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(changeOrders.companyId, companyId),
          eq(changeOrders.id, co.id),
          eq(changeOrders.status, "in_review"),
        ),
      )
      .returning();

    if (!approved) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Change order could not be approved",
      });
    }
    working = approved;
  }

  if (!canTransitionChangeOrder("approved", "implemented")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid transition approved → implemented",
    });
  }

  const [implemented] = await tx
    .update(changeOrders)
    .set({
      status: "implemented",
      approvedAt: working.approvedAt ?? now,
      implementedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(changeOrders.companyId, companyId),
        eq(changeOrders.id, co.id),
        inArray(changeOrders.status, ["approved"]),
      ),
    )
    .returning();

  if (!implemented) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Change order could not be implemented after approval",
    });
  }

  await tx.insert(auditLogs).values({
    companyId,
    actorId,
    action: "change_order.implement",
    entityType: "change_order",
    entityId: co.id,
    metadata: {
      coNumber: co.coNumber,
      releasedRevisionIds,
      releasedRoutingRevisionIds,
      via: "implementChangeOrder",
    },
  });

  return implemented;
}
