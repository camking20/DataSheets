import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  dataSheets,
  partRevisions,
  parts,
  dimensions,
  measurements,
  users,
  companies,
  exportJobs,
  auditLogs,
} from "@datasheets/db";
import { toCsv, toExcel, toPdf, type ExportSheetPayload } from "@datasheets/exports";
import { router, tenantProcedure, asTenant } from "../trpc.js";

const ExportFormatSchema = z.enum(["csv", "excel", "pdf"]);

const mimeTypes: Record<z.infer<typeof ExportFormatSchema>, string> = {
  csv: "text/csv",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const extensions: Record<z.infer<typeof ExportFormatSchema>, string> = {
  csv: "csv",
  excel: "xlsx",
  pdf: "pdf",
};

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, "_");
}

export const exportsRouter = router({
  generate: tenantProcedure
    .input(
      z.object({
        dataSheetId: z.string().uuid(),
        format: ExportFormatSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sheet, part, exportPayload } = await asTenant(
        ctx.db,
        ctx.companyId,
        async (tx) => {
          const [sheet] = await tx
            .select()
            .from(dataSheets)
            .where(eq(dataSheets.id, input.dataSheetId))
            .limit(1);
          if (!sheet) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Data sheet not found" });
          }
          if (sheet.status !== "completed") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Only completed sheets can be exported",
            });
          }

          const [revision] = await tx
            .select()
            .from(partRevisions)
            .where(eq(partRevisions.id, sheet.partRevisionId))
            .limit(1);
          if (!revision) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Revision not found" });
          }

          const [part] = await tx
            .select()
            .from(parts)
            .where(eq(parts.id, revision.partId))
            .limit(1);
          if (!part) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Part not found" });
          }

          const [company] = await tx
            .select()
            .from(companies)
            .where(eq(companies.id, ctx.companyId))
            .limit(1);

          const dims = await tx
            .select()
            .from(dimensions)
            .where(eq(dimensions.partRevisionId, revision.id))
            .orderBy(asc(dimensions.displayOrder));

          const currentMeasurements = await tx
            .select()
            .from(measurements)
            .where(
              and(
                eq(measurements.dataSheetId, sheet.id),
                eq(measurements.isCurrent, true),
              ),
            );

          let operatorName: string | null = null;
          if (sheet.operatorId) {
            const [operator] = await tx
              .select()
              .from(users)
              .where(eq(users.id, sheet.operatorId))
              .limit(1);
            operatorName = operator?.name ?? null;
          }

          const exportPayload: ExportSheetPayload = {
            companyName: company?.name ?? "",
            partNumber: part.partNumber,
            revision: revision.rev,
            description: part.description,
            customer: part.customer,
            lotNumber: sheet.lotNumber,
            lotSize: sheet.lotSize,
            operatorName,
            completedAt: sheet.completedAt ? sheet.completedAt.toISOString() : null,
            dimensions: dims.map((d) => ({
              id: d.id,
              name: d.name,
              balloonNumber: d.balloonNumber,
              unit: d.unit,
              nominal: d.nominal,
              usl: d.usl,
              lsl: d.lsl,
            })),
            measurements: currentMeasurements.map((m) => ({
              dimensionId: m.dimensionId,
              sampleIndex: m.sampleIndex,
              value: m.value,
              disposition: m.disposition,
            })),
          };

          return { sheet, part, exportPayload };
        },
      );

      let buffer: Buffer;
      if (input.format === "csv") {
        buffer = Buffer.from(toCsv(exportPayload), "utf-8");
      } else if (input.format === "excel") {
        buffer = await toExcel(exportPayload);
      } else {
        buffer = await toPdf(exportPayload);
      }

      const fileName = `${sanitize(part.partNumber)}_${sanitize(sheet.lotNumber)}.${extensions[input.format]}`;
      const base64 = buffer.toString("base64");
      const mimeType = mimeTypes[input.format];

      await asTenant(ctx.db, ctx.companyId, async (tx) => {
        await tx.insert(exportJobs).values({
          companyId: ctx.companyId,
          dataSheetId: sheet.id,
          format: input.format,
          status: "completed",
          requestedBy: ctx.auth.user.id,
          fileName,
          completedAt: new Date(),
        });

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "export.generate",
          entityType: "data_sheet",
          entityId: sheet.id,
          metadata: { format: input.format, fileName },
        });
      });

      return { fileName, mimeType, base64 };
    }),
});
