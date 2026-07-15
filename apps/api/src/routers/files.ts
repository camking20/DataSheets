/**
 * File upload / download procedures.
 *
 * Requires workspace dependency: add `"@datasheets/storage": "workspace:*"`
 * to apps/api/package.json dependencies (not added here — ownership is this file only).
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { files, auditLogs } from "@datasheets/db";
import {
  assertTenantStorageKey,
  createStorage,
  sha256,
} from "@datasheets/storage";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";

const FileKindSchema = z.enum(["pdf", "cad", "image", "other"]);

/** Reject base64 payloads that decode larger than this (25 MiB). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const filesRouter = router({
  upload: requireRoles("engineer", "admin", "quality")
    .input(
      z.object({
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        contentBase64: z.string().min(1),
        kind: FileKindSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = Buffer.from(input.contentBase64, "base64");
      if (body.byteLength > MAX_UPLOAD_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Upload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`,
        });
      }
      const digest = sha256(body);
      const storage = createStorage();
      const storageKey = storage.buildKey(ctx.companyId, input.fileName);
      const stored = await storage.putObject({
        key: storageKey,
        body,
        contentType: input.mimeType,
      });

      try {
        return await asTenant(ctx.db, ctx.companyId, async (tx) => {
          const [file] = await tx
            .insert(files)
            .values({
              companyId: ctx.companyId,
              storageKey: stored.storageKey,
              sha256: digest,
              sizeBytes: stored.sizeBytes,
              mimeType: stored.mimeType,
              kind: input.kind,
              originalName: input.fileName,
              uploadedBy: ctx.auth.user.id,
            })
            .returning();

          await tx.insert(auditLogs).values({
            companyId: ctx.companyId,
            actorId: ctx.auth.user.id,
            action: "file.upload",
            entityType: "file",
            entityId: file!.id,
            metadata: {
              fileName: input.fileName,
              kind: input.kind,
              sha256: digest,
              sizeBytes: stored.sizeBytes,
              storageKey: stored.storageKey,
            },
          });

          return {
            id: file!.id,
            storageKey: file!.storageKey,
            sha256: file!.sha256,
            sizeBytes: file!.sizeBytes,
            mimeType: file!.mimeType,
            kind: file!.kind,
          };
        });
      } catch (err) {
        // Compensating delete: object was written but DB insert failed.
        try {
          await storage.deleteObject(stored.storageKey);
        } catch {
          // Best-effort cleanup; rethrow the original DB error.
        }
        throw err;
      }
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [file] = await tx
          .select()
          .from(files)
          .where(eq(files.id, input.id))
          .limit(1);
        if (!file) throw new TRPCError({ code: "NOT_FOUND" });
        return file;
      });
    }),

  /** Content download for any authorized tenant member (operators need WI PDFs later). */
  getDownload: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const file = await asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [row] = await tx
          .select()
          .from(files)
          .where(eq(files.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return row;
      });

      try {
        assertTenantStorageKey(ctx.companyId, file.storageKey);
      } catch {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const storage = createStorage();
      const object = await storage.getObject(file.storageKey);

      return {
        fileName: file.originalName ?? "file",
        mimeType: file.mimeType ?? object.contentType ?? "application/octet-stream",
        contentBase64: object.body.toString("base64"),
      };
    }),
});
