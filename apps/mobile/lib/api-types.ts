import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { CreateDataSheetSchema, RecordMeasurementSchema, SheetStatusSchema } from "@datasheets/core";
import type { CapabilityResult } from "@datasheets/core";
import type { Part, PartRevision, Dimension, DataSheet, Measurement, CapabilitySnapshot } from "@datasheets/db";

/**
 * Type-only mirror of `apps/api/src/root.ts`'s `AppRouter`, scoped to the
 * procedures this app calls (see `apps/api/src/routers/{auth,parts,sheets}.ts`).
 *
 * `apps/mobile` deliberately has zero *runtime* dependency on `apps/api` or
 * `@datasheets/db` (both pull in Postgres/Fastify server-only code) — this
 * file only borrows their *types* via `import type`, which TypeScript/Babel
 * erase completely at compile time, so nothing server-side ever reaches the
 * RN bundle. `initTRPC` here is only ever used to derive a structural type;
 * this module is never imported as a value, only as `import type { AppRouter }`.
 *
 * If `@datasheets/api` starts publishing a real `AppRouter` type export, this
 * file should be deleted in favor of importing it directly.
 */
const t = initTRPC.create({ transformer: superjson });

interface SamplePlanEntry {
  dimensionId: string;
  sampleIndices: number[];
}

interface SheetListRow {
  sheet: DataSheet;
  revision: PartRevision;
  part: Part;
}

interface SheetCreateOutput {
  sheet: DataSheet;
  dimensions: Dimension[];
  samplePlan: SamplePlanEntry[];
}

interface SheetDetailOutput {
  sheet: DataSheet;
  part: Part | null;
  revision: PartRevision;
  dimensions: Dimension[];
  measurements: Measurement[];
  samplePlan: SamplePlanEntry[];
}

interface LiveCapabilityRow extends CapabilityResult {
  dimensionId: string;
  dimensionName: string;
}

interface SheetCompleteOutput {
  sheet: DataSheet;
  snapshots: CapabilitySnapshot[];
}

type MembershipRole = "operator" | "engineer" | "admin" | "quality";

interface LoginOutput {
  token: string;
  user: { id: string; email: string; name: string };
  company: { id: string; name: string; slug: string; role: MembershipRole } | null;
}

interface MeOutput {
  user: { id: string; email: string; name: string };
  companyId: string | null;
  companyName: string | null;
  role: MembershipRole | null;
  memberships: Array<{
    companyId: string;
    role: MembershipRole;
    companyName: string;
    companySlug: string;
  }>;
}

const unimplemented = <T>(): Promise<T> => {
  throw new Error("api-types.ts is a type-only contract and must never run");
};

export const appRouter = t.router({
  auth: t.router({
    login: t.procedure
      .input(z.object({ email: z.string().email(), password: z.string() }))
      .mutation(() => unimplemented<LoginOutput>()),
    me: t.procedure.query(() => unimplemented<MeOutput>()),
    logout: t.procedure.mutation(() => unimplemented<{ ok: boolean }>()),
  }),
  parts: t.router({
    search: t.procedure
      .input(z.object({ q: z.string().min(1) }))
      .query(() => unimplemented<Part[]>()),
    getReleasedByPartNumber: t.procedure
      .input(z.object({ partNumber: z.string().min(1) }))
      .query(() => unimplemented<{ part: Part; revision: PartRevision; dimensions: Dimension[] }>()),
  }),
  sheets: t.router({
    create: t.procedure.input(CreateDataSheetSchema).mutation(() => unimplemented<SheetCreateOutput>()),
    getById: t.procedure
      .input(z.object({ id: z.string().uuid() }))
      .query(() => unimplemented<SheetDetailOutput>()),
    list: t.procedure
      .input(z.object({ status: SheetStatusSchema.optional() }).optional())
      .query(() => unimplemented<SheetListRow[]>()),
    recordMeasurement: t.procedure
      .input(RecordMeasurementSchema)
      .mutation(() => unimplemented<Measurement>()),
    liveCapability: t.procedure
      .input(z.object({ sheetId: z.string().uuid() }))
      .query(() => unimplemented<LiveCapabilityRow[]>()),
    complete: t.procedure
      .input(z.object({ dataSheetId: z.string().uuid(), force: z.boolean().default(false) }))
      .mutation(() => unimplemented<SheetCompleteOutput>()),
  }),
});

export type AppRouter = typeof appRouter;
