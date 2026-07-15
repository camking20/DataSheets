/**
 * Controlled documents tRPC router.
 *
 * apps/api package.json needs workspace deps:
 *   "@datasheets/storage": "workspace:*"
 *   "@datasheets/google": "workspace:*"
 */
import { z } from "zod";
import { eq, and, desc, or, ilike, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  documents,
  documentRevisions,
  parts,
  signatures,
  auditLogs,
  files,
  googleConnections,
  type DocumentRevision,
  type DbTx,
} from "@datasheets/db";
import {
  DocumentTypeSchema,
  DocumentRevisionStatusSchema,
  assertDocumentRevisionTransition,
  type DocumentType,
  type SignatureMeaning,
} from "@datasheets/core";
import { createStorage } from "@datasheets/storage";
import {
  clientFromRefreshToken,
  createGoogleDoc,
  copyFile,
  exportFileAsPdf,
} from "@datasheets/google";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { nextNumber, DOC_TYPE_PREFIX } from "../services/numbering.js";
import { releaseDocumentRevision } from "../services/release.js";

const DOCS_LIST_LIMIT = 100;
const GOOGLE_DOC_TYPES: ReadonlySet<DocumentType> = new Set(["pro", "wi", "frm"]);

type RevisionSummary = Pick<
  DocumentRevision,
  | "id"
  | "rev"
  | "status"
  | "googleFileId"
  | "pdfFileId"
  | "cadFileId"
  | "changeSummary"
  | "releasedAt"
  | "createdAt"
  | "updatedAt"
>;

function toRevisionSummary(rev: DocumentRevision): RevisionSummary {
  return {
    id: rev.id,
    rev: rev.rev,
    status: rev.status,
    googleFileId: rev.googleFileId,
    pdfFileId: rev.pdfFileId,
    cadFileId: rev.cadFileId,
    changeSummary: rev.changeSummary,
    releasedAt: rev.releasedAt,
    createdAt: rev.createdAt,
    updatedAt: rev.updatedAt,
  };
}

/** Prefer released; otherwise most recently created. */
function pickCurrentRevision(
  revs: DocumentRevision[],
): DocumentRevision | null {
  const released = revs.find((r) => r.status === "released");
  if (released) return released;
  if (revs.length === 0) return null;
  return [...revs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;
}

/** A→B…Z→AA (base-26 letter bump). */
function nextRevLetter(rev: string): string {
  const chars = rev.toUpperCase().split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]!;
    if (c >= "A" && c < "Z") {
      chars[i] = String.fromCharCode(c.charCodeAt(0) + 1);
      return chars.join("");
    }
    if (c === "Z") {
      chars[i] = "A";
      continue;
    }
    // Non A–Z: append "A"
    return rev.toUpperCase() + "A";
  }
  return "A" + chars.join("");
}

function getStorage() {
  return createStorage();
}

async function storeUploadedBytes(opts: {
  companyId: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  kind: "pdf" | "cad";
  uploadedBy: string;
  tx: DbTx;
}) {
  const body = Buffer.from(opts.contentBase64, "base64");
  if (body.byteLength === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Empty file content",
    });
  }

  const storage = getStorage();
  const key = storage.buildKey(opts.companyId, opts.fileName);
  const stored = await storage.putObject({
    key,
    body,
    contentType: opts.mimeType,
  });

  const [fileRow] = await opts.tx
    .insert(files)
    .values({
      companyId: opts.companyId,
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      mimeType: stored.mimeType,
      kind: opts.kind,
      originalName: opts.fileName,
      uploadedBy: opts.uploadedBy,
    })
    .returning();

  return fileRow!;
}

async function tryCreateGoogleFile(opts: {
  db: Parameters<typeof asTenant>[0];
  companyId: string;
  docType: DocumentType;
  title: string;
  sourceFrmId?: string | null;
}): Promise<string | null> {
  if (!GOOGLE_DOC_TYPES.has(opts.docType)) return null;

  try {
    // Short read txn only — Google Drive I/O runs after it commits.
    const driveCtx = await asTenant(opts.db, opts.companyId, async (tx) => {
      const [conn] = await tx
        .select()
        .from(googleConnections)
        .where(eq(googleConnections.companyId, opts.companyId))
        .limit(1);

      if (!conn?.encryptedRefreshToken) return null;

      const prefix = DOC_TYPE_PREFIX[opts.docType];
      const folders = (conn.folders ?? {}) as Record<string, string>;
      const parentFolderId = folders[prefix] ?? conn.rootFolderId ?? null;
      if (!parentFolderId) return null;

      let sourceGoogleFileId: string | null = null;
      if (opts.sourceFrmId) {
        const sourceRevs = await tx
          .select()
          .from(documentRevisions)
          .where(eq(documentRevisions.documentId, opts.sourceFrmId))
          .orderBy(desc(documentRevisions.createdAt));

        const sourceReleased =
          sourceRevs.find((r) => r.status === "released") ??
          sourceRevs.find((r) => r.googleFileId);

        sourceGoogleFileId = sourceReleased?.googleFileId ?? null;
      }

      return {
        encryptedRefreshToken: conn.encryptedRefreshToken,
        parentFolderId,
        sourceGoogleFileId,
      };
    });

    if (!driveCtx) return null;

    const auth = clientFromRefreshToken(driveCtx.encryptedRefreshToken);
    const docTitle = opts.title || "document";

    if (driveCtx.sourceGoogleFileId) {
      const copied = await copyFile(auth, {
        fileId: driveCtx.sourceGoogleFileId,
        title: docTitle,
        parentFolderId: driveCtx.parentFolderId,
      });
      return copied.fileId;
    }

    const created = await createGoogleDoc(auth, {
      parentFolderId: driveCtx.parentFolderId,
      title: docTitle,
    });
    return created.fileId;
  } catch {
    // Google is optional — leave google_file_id null on failure.
    return null;
  }
}

const UploadInputSchema = z.object({
  revisionId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
  kind: z.enum(["pdf", "cad"]),
});

export const documentsRouter = router({
  list: tenantProcedure
    .input(
      z
        .object({
          docType: DocumentTypeSchema.optional(),
          status: DocumentRevisionStatusSchema.optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const conditions = [eq(documents.isActive, true)];
        if (input?.docType) {
          conditions.push(eq(documents.docType, input.docType));
        }
        const q = input?.search?.trim();
        if (q) {
          const pattern = `%${q}%`;
          conditions.push(
            or(
              ilike(documents.docNumber, pattern),
              ilike(documents.title, pattern),
            )!,
          );
        }

        const docs = await tx
          .select()
          .from(documents)
          .where(and(...conditions))
          .orderBy(desc(documents.updatedAt))
          .limit(DOCS_LIST_LIMIT);

        if (docs.length === 0) return [];

        const docIds = docs.map((d) => d.id);
        const allRevs = await tx
          .select()
          .from(documentRevisions)
          .where(inArray(documentRevisions.documentId, docIds))
          .orderBy(desc(documentRevisions.createdAt));

        const revsByDoc = new Map<string, DocumentRevision[]>();
        for (const rev of allRevs) {
          const list = revsByDoc.get(rev.documentId) ?? [];
          list.push(rev);
          revsByDoc.set(rev.documentId, list);
        }

        const results: Array<{
          document: (typeof docs)[number];
          currentRevision: RevisionSummary | null;
        }> = [];

        for (const doc of docs) {
          const current = pickCurrentRevision(revsByDoc.get(doc.id) ?? []);
          if (input?.status && current?.status !== input.status) {
            continue;
          }
          results.push({
            document: doc,
            currentRevision: current ? toRevisionSummary(current) : null,
          });
        }

        return results;
      });
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [doc] = await tx
          .select()
          .from(documents)
          .where(eq(documents.id, input.id))
          .limit(1);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

        const revisions = await tx
          .select()
          .from(documentRevisions)
          .where(eq(documentRevisions.documentId, doc.id))
          .orderBy(desc(documentRevisions.createdAt));

        let part = null;
        if (doc.partId) {
          const [p] = await tx
            .select()
            .from(parts)
            .where(eq(parts.id, doc.partId))
            .limit(1);
          part = p ?? null;
        }

        const revIds = revisions.map((r) => r.id);
        const revisionSignatures =
          revIds.length === 0
            ? []
            : await tx
                .select()
                .from(signatures)
                .where(
                  and(
                    eq(signatures.entityType, "document_revision"),
                    inArray(signatures.entityId, revIds),
                  ),
                )
                .orderBy(desc(signatures.signedAt));

        const audit = await tx
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityType, "document"),
              eq(auditLogs.entityId, doc.id),
            ),
          )
          .orderBy(desc(auditLogs.createdAt));

        return {
          document: doc,
          revisions,
          part,
          signatures: revisionSignatures,
          audit,
        };
      });
    }),

  create: requireRoles("engineer", "admin", "quality")
    .input(
      z.object({
        docType: DocumentTypeSchema,
        title: z.string().min(1).max(500),
        partId: z.string().uuid().optional(),
        sourceFrmId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Short txn: allocate number + persist rows (no Google I/O while holding locks).
      const created = await asTenant(ctx.db, ctx.companyId, async (tx) => {
        if (input.partId) {
          const [part] = await tx
            .select()
            .from(parts)
            .where(eq(parts.id, input.partId))
            .limit(1);
          if (!part) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Part not found",
            });
          }
        }

        if (input.sourceFrmId) {
          const [source] = await tx
            .select()
            .from(documents)
            .where(eq(documents.id, input.sourceFrmId))
            .limit(1);
          if (!source || source.docType !== "frm") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "sourceFrmId must reference an FRM document",
            });
          }
        }

        const prefix = DOC_TYPE_PREFIX[input.docType];
        const docNumber = await nextNumber(tx, ctx.companyId, prefix);

        const [doc] = await tx
          .insert(documents)
          .values({
            companyId: ctx.companyId,
            docNumber,
            docType: input.docType,
            title: input.title,
            partId: input.partId ?? null,
            sourceFrmId: input.sourceFrmId ?? null,
          })
          .returning();

        const [rev] = await tx
          .insert(documentRevisions)
          .values({
            companyId: ctx.companyId,
            documentId: doc!.id,
            rev: "A",
            status: "draft",
            googleFileId: null,
            createdBy: ctx.auth.user.id,
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "document.create",
          entityType: "document",
          entityId: doc!.id,
          metadata: {
            docNumber,
            docType: input.docType,
            revisionId: rev!.id,
            googleFileId: null,
          },
        });

        return { document: doc!, revision: rev!, docNumber };
      });

      // Optional Google create — soft-fails; never holds number_counters lock.
      const googleFileId = await tryCreateGoogleFile({
        db: ctx.db,
        companyId: ctx.companyId,
        docType: input.docType,
        title: `${created.docNumber} – ${input.title}`,
        sourceFrmId: input.sourceFrmId,
      });

      if (!googleFileId) {
        return { document: created.document, revision: created.revision };
      }

      const revision = await asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [updated] = await tx
          .update(documentRevisions)
          .set({ googleFileId, updatedAt: new Date() })
          .where(eq(documentRevisions.id, created.revision.id))
          .returning();
        return updated ?? created.revision;
      });

      return { document: created.document, revision };
    }),

  updateDraft: requireRoles("engineer", "admin", "quality")
    .input(
      z.object({
        revisionId: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        changeSummary: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(documentRevisions)
          .where(eq(documentRevisions.id, input.revisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
        if (rev.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only draft revisions can be updated",
          });
        }

        let document = null;
        if (input.title !== undefined) {
          // Title is shared across revisions — do not retitle once any
          // revision has been released (change control).
          const [released] = await tx
            .select({ id: documentRevisions.id })
            .from(documentRevisions)
            .where(
              and(
                eq(documentRevisions.documentId, rev.documentId),
                eq(documentRevisions.status, "released"),
              ),
            )
            .limit(1);
          if (released) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot change document title after a revision has been released",
            });
          }

          const [updatedDoc] = await tx
            .update(documents)
            .set({ title: input.title, updatedAt: new Date() })
            .where(eq(documents.id, rev.documentId))
            .returning();
          document = updatedDoc!;
        } else {
          const [doc] = await tx
            .select()
            .from(documents)
            .where(eq(documents.id, rev.documentId))
            .limit(1);
          document = doc!;
        }

        let revision = rev;
        if (input.changeSummary !== undefined) {
          const [updatedRev] = await tx
            .update(documentRevisions)
            .set({
              changeSummary: input.changeSummary,
              updatedAt: new Date(),
            })
            .where(eq(documentRevisions.id, rev.id))
            .returning();
          revision = updatedRev!;
        }

        return { document, revision };
      });
    }),

  submitForReview: requireRoles("engineer", "admin", "quality")
    .input(z.object({ revisionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Short txn: validate + load Drive credentials (no Google/storage I/O).
      const prep = await asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(documentRevisions)
          .where(eq(documentRevisions.id, input.revisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
        if (rev.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only draft revisions can be submitted for review",
          });
        }
        assertDocumentRevisionTransition("draft", "in_review");

        if (!rev.googleFileId && !rev.pdfFileId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Revision has no Google file and no PDF — upload a PDF before submitting (e.g. DRW)",
          });
        }

        let encryptedRefreshToken: string | null = null;
        let docNumber: string | null = null;
        if (rev.googleFileId) {
          const [conn] = await tx
            .select()
            .from(googleConnections)
            .where(eq(googleConnections.companyId, ctx.companyId))
            .limit(1);

          if (!conn?.encryptedRefreshToken) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Google connection required to export PDF from Drive",
            });
          }
          encryptedRefreshToken = conn.encryptedRefreshToken;

          const [doc] = await tx
            .select({ docNumber: documents.docNumber })
            .from(documents)
            .where(eq(documents.id, rev.documentId))
            .limit(1);
          docNumber = doc?.docNumber ?? null;
        }

        return {
          rev,
          encryptedRefreshToken,
          docNumber,
        };
      });

      type StoredPdf = {
        storageKey: string;
        sha256: string;
        sizeBytes: number;
        mimeType: string;
        fileName: string;
      };
      let pendingPdf: StoredPdf | null = null;

      if (prep.rev.googleFileId && prep.encryptedRefreshToken) {
        try {
          const auth = clientFromRefreshToken(prep.encryptedRefreshToken);
          const pdfBuffer = await exportFileAsPdf(
            auth,
            prep.rev.googleFileId,
          );
          const fileName = `${prep.docNumber ?? "doc"}-rev${prep.rev.rev}.pdf`;

          const storage = getStorage();
          const key = storage.buildKey(ctx.companyId, fileName);
          const stored = await storage.putObject({
            key,
            body: pdfBuffer,
            contentType: "application/pdf",
          });
          pendingPdf = {
            storageKey: stored.storageKey,
            sha256: stored.sha256,
            sizeBytes: stored.sizeBytes,
            mimeType: stored.mimeType,
            fileName,
          };
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to export Google Doc to PDF",
            cause: err,
          });
        }
      }

      // Second short txn: persist file row + transition status.
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        let pdfFileId = prep.rev.pdfFileId;

        if (pendingPdf) {
          const [fileRow] = await tx
            .insert(files)
            .values({
              companyId: ctx.companyId,
              storageKey: pendingPdf.storageKey,
              sha256: pendingPdf.sha256,
              sizeBytes: pendingPdf.sizeBytes,
              mimeType: pendingPdf.mimeType,
              kind: "pdf",
              originalName: pendingPdf.fileName,
              uploadedBy: ctx.auth.user.id,
            })
            .returning();
          pdfFileId = fileRow!.id;
        }

        const [updated] = await tx
          .update(documentRevisions)
          .set({
            status: "in_review",
            pdfFileId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(documentRevisions.id, prep.rev.id),
              eq(documentRevisions.status, "draft"),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Revision is no longer a draft",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "document.submit_for_review",
          entityType: "document",
          entityId: prep.rev.documentId,
          metadata: {
            revisionId: prep.rev.id,
            pdfFileId,
            googleFileId: prep.rev.googleFileId,
          },
        });

        return updated;
      });
    }),

  uploadPdf: requireRoles("engineer", "admin")
    .input(UploadInputSchema.omit({ kind: true }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(documentRevisions)
          .where(eq(documentRevisions.id, input.revisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
        if (rev.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Files can only be uploaded to draft revisions",
          });
        }

        // Multipart uploads come later; base64 is the interim transport.
        const fileRow = await storeUploadedBytes({
          companyId: ctx.companyId,
          fileName: input.fileName,
          mimeType: input.mimeType || "application/pdf",
          contentBase64: input.contentBase64,
          kind: "pdf",
          uploadedBy: ctx.auth.user.id,
          tx,
        });

        const [updated] = await tx
          .update(documentRevisions)
          .set({ pdfFileId: fileRow.id, updatedAt: new Date() })
          .where(eq(documentRevisions.id, rev.id))
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "document.upload_pdf",
          entityType: "document",
          entityId: rev.documentId,
          metadata: {
            revisionId: rev.id,
            fileId: fileRow.id,
            sha256: fileRow.sha256,
          },
        });

        return { revision: updated!, file: fileRow };
      });
    }),

  uploadCad: requireRoles("engineer", "admin")
    .input(UploadInputSchema.omit({ kind: true }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(documentRevisions)
          .where(eq(documentRevisions.id, input.revisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
        if (rev.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Files can only be uploaded to draft revisions",
          });
        }

        const fileRow = await storeUploadedBytes({
          companyId: ctx.companyId,
          fileName: input.fileName,
          mimeType: input.mimeType || "application/octet-stream",
          contentBase64: input.contentBase64,
          kind: "cad",
          uploadedBy: ctx.auth.user.id,
          tx,
        });

        const [updated] = await tx
          .update(documentRevisions)
          .set({ cadFileId: fileRow.id, updatedAt: new Date() })
          .where(eq(documentRevisions.id, rev.id))
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "document.upload_cad",
          entityType: "document",
          entityId: rev.documentId,
          metadata: {
            revisionId: rev.id,
            fileId: fileRow.id,
            sha256: fileRow.sha256,
          },
        });

        return { revision: updated!, file: fileRow };
      });
    }),

  createRevisionFromReleased: requireRoles("engineer", "admin")
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Short txn: validate + insert draft rev (no Google I/O).
      const branched = await asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [doc] = await tx
          .select()
          .from(documents)
          .where(eq(documents.id, input.documentId))
          .limit(1);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

        const [released] = await tx
          .select()
          .from(documentRevisions)
          .where(
            and(
              eq(documentRevisions.documentId, doc.id),
              eq(documentRevisions.status, "released"),
            ),
          )
          .orderBy(desc(documentRevisions.releasedAt))
          .limit(1);

        if (!released) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No released revision to branch from",
          });
        }

        const existingDraft = await tx
          .select()
          .from(documentRevisions)
          .where(
            and(
              eq(documentRevisions.documentId, doc.id),
              eq(documentRevisions.status, "draft"),
            ),
          )
          .limit(1);
        if (existingDraft.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A draft revision already exists for this document",
          });
        }

        const newRevLetter = nextRevLetter(released.rev);

        const [newRev] = await tx
          .insert(documentRevisions)
          .values({
            companyId: ctx.companyId,
            documentId: doc.id,
            rev: newRevLetter,
            status: "draft",
            googleFileId: null,
            changeSummary: `Branched from rev ${released.rev}`,
            createdBy: ctx.auth.user.id,
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "document.revision.branch",
          entityType: "document",
          entityId: doc.id,
          metadata: {
            fromRevisionId: released.id,
            revisionId: newRev!.id,
            rev: newRevLetter,
          },
        });

        return {
          revision: newRev!,
          doc,
          newRevLetter,
        };
      });

      // Optional Google copy — soft-fails outside the persist txn.
      const googleFileId = await tryCreateGoogleFile({
        db: ctx.db,
        companyId: ctx.companyId,
        docType: branched.doc.docType,
        title: `${branched.doc.docNumber} – ${branched.doc.title ?? "revision"} (${branched.newRevLetter})`,
        sourceFrmId: branched.doc.id,
      });

      if (!googleFileId) return branched.revision;

      const [updated] = await asTenant(ctx.db, ctx.companyId, async (tx) => {
        return tx
          .update(documentRevisions)
          .set({ googleFileId, updatedAt: new Date() })
          .where(eq(documentRevisions.id, branched.revision.id))
          .returning();
      });

      return updated ?? branched.revision;
    }),

  listPendingApprovals: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      const canMe = ctx.role === "engineer" || ctx.role === "admin";
      const canQa = ctx.role === "quality" || ctx.role === "admin";
      if (!canMe && !canQa) return [];

      const inReview = await tx
        .select({
          revision: documentRevisions,
          document: documents,
        })
        .from(documentRevisions)
        .innerJoin(
          documents,
          eq(documents.id, documentRevisions.documentId),
        )
        .where(eq(documentRevisions.status, "in_review"))
        .orderBy(desc(documentRevisions.updatedAt));

      if (inReview.length === 0) return [];

      const revIds = inReview.map((r) => r.revision.id);
      const allSigs = await tx
        .select()
        .from(signatures)
        .where(
          and(
            eq(signatures.entityType, "document_revision"),
            inArray(signatures.entityId, revIds),
          ),
        );

      const sigsByRev = new Map<string, SignatureMeaning[]>();
      for (const s of allSigs) {
        const list = sigsByRev.get(s.entityId) ?? [];
        list.push(s.meaning as SignatureMeaning);
        sigsByRev.set(s.entityId, list);
      }

      return inReview
        .filter(({ revision }) => {
          const meanings = new Set(sigsByRev.get(revision.id) ?? []);
          const needsMe = canMe && !meanings.has("me_approval");
          const needsQa = canQa && !meanings.has("qa_approval");
          return needsMe || needsQa;
        })
        .map(({ revision, document }) => ({
          document,
          revision: toRevisionSummary(revision),
          missing: {
            me_approval:
              canMe &&
              !(sigsByRev.get(revision.id) ?? []).includes("me_approval"),
            qa_approval:
              canQa &&
              !(sigsByRev.get(revision.id) ?? []).includes("qa_approval"),
          },
        }));
    });
  }),

  /**
   * Release when both ME + QA signatures exist.
   * Prefer change-order bulk release; this is the single-doc escape hatch.
   */
  releaseRevision: requireRoles("engineer", "admin", "quality")
    .input(z.object({ revisionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        return releaseDocumentRevision(tx, {
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          revisionId: input.revisionId,
        });
      });
    }),
});
