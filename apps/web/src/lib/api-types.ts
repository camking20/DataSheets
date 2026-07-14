/**
 * Hand-maintained mirror of the `@datasheets/api` tRPC router shapes.
 *
 * The API's `AppRouter` type isn't published from a shared package yet
 * (`apps/api` has no `root.ts` combining its routers), so importing it
 * directly would be a fragile cross-app relative import that breaks the
 * moment the API restructures its `src` layout. Instead we build a
 * type-only mirror router below using `initTRPC` directly (no server, no
 * context, never invoked at runtime) — this gives `createTRPCReact` a
 * genuine `AnyRouter`-shaped generic, so every page gets full
 * autocomplete and type checking for inputs/outputs while the actual
 * network calls hit the real running API in `src/lib/trpc.ts`.
 *
 * `auth.*` and `parts.*` below match the routers that exist today in
 * `apps/api/src/routers` field-for-field (including reusing the same zod
 * schemas from `@datasheets/core`). `sheets.*`, `dashboard.overview`, and
 * `exports.generate` describe the contract this app expects — implement
 * those routers server-side (see the README) and these pages light up with
 * no frontend changes.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import {
  CreatePartSchema,
  CreateDimensionSchema,
  UpdateDimensionSchema,
  CreateDataSheetSchema,
  RecordMeasurementSchema,
  type Disposition,
  type MembershipRole,
  type RevisionStatus,
  type SheetStatus,
  type FrequencyType,
} from "@datasheets/core";

export type { Disposition, MembershipRole, RevisionStatus, SheetStatus, FrequencyType };

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  role?: MembershipRole;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface MembershipRow {
  companyId: string;
  role: MembershipRole;
  companyName: string;
  companySlug: string;
}

export interface MeResult {
  user: SessionUser;
  companyId: string | null;
  companyName: string | null;
  role: MembershipRole | null;
  memberships: MembershipRow[];
}

export interface Part {
  id: string;
  companyId: string;
  partNumber: string;
  description: string | null;
  customer: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PartRevision {
  id: string;
  companyId: string;
  partId: string;
  rev: string;
  status: RevisionStatus;
  notes: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Dimension {
  id: string;
  companyId: string;
  partRevisionId: string;
  name: string;
  balloonNumber: string | null;
  unit: string;
  nominal: number;
  usl: number | null;
  lsl: number | null;
  warningFraction: number;
  gageMethod: string | null;
  frequencyType: FrequencyType;
  frequencyN: number;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataSheet {
  id: string;
  companyId: string;
  partRevisionId: string;
  lotNumber: string;
  lotSize: number;
  status: SheetStatus;
  operatorId: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Measurement {
  id: string;
  dataSheetId: string;
  dimensionId: string;
  sampleIndex: number;
  value: number;
  disposition: Disposition;
  measuredBy: string | null;
  measuredAt: string;
}

/** Matches `dashboard.overview` from apps/api */
export interface DashboardOverview {
  counts: {
    parts: number;
    inProgressSheets: number;
    completedSheets: number;
  };
  recentIssues: Array<{
    measurement: Measurement;
    dimensionName: string;
    balloonNumber: string | null;
    unit: string;
    dataSheetId: string;
    lotNumber: string;
    partNumber: string;
  }>;
  latestCapabilitySnapshots: Array<{
    snapshot: {
      id: string;
      partId: string;
      dimensionId: string;
      dataSheetId: string;
      n: number;
      mean: number | null;
      stdDev: number | null;
      cp: number | null;
      cpk: number | null;
      percentYellow: number;
      percentRed: number;
      createdAt: string | Date;
    };
    partNumber: string;
    dimensionName: string;
  }>;
}

/** Matches `sheets.list` row shape from apps/api */
export interface SheetListRow {
  sheet: DataSheet;
  revision: PartRevision;
  part: Part;
}

export interface SheetDetail {
  sheet: DataSheet;
  part: Part | null;
  revision: PartRevision;
  dimensions: Dimension[];
  measurements: Measurement[];
}

export interface ExportFileResult {
  fileName: string;
  mimeType: string;
  base64: string;
}

const notImplemented = (path: string) => (): never => {
  throw new Error(
    `${path} is a type-only stub used for client typing — it is never called. ` +
      "The real implementation lives in apps/api.",
  );
};

// `transformer` here only exists to satisfy tRPC v11's client/server transformer
// consistency check at the type level — this router is never executed, so the
// real transformer behavior is entirely driven by the `httpBatchLink` config
// in `src/lib/trpc.ts`, which must (and does) also specify `superjson`.
const t = initTRPC.create({ transformer: superjson });

/**
 * Type-only router. Every resolver throws immediately and none of this is
 * ever invoked — `httpBatchLink` in `src/lib/trpc.ts` talks to the real
 * API over HTTP. This exists purely so `AppRouter` is a genuine
 * `AnyRouter`, which `createTRPCReact` requires for its proxy typing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used for `typeof appRouter` below
const appRouter = t.router({
  auth: t.router({
    register: t.procedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(8),
          name: z.string().min(1),
          companyName: z.string().min(1),
          companySlug: z.string().min(2).max(50),
        }),
      )
      .mutation(
        notImplemented("auth.register") as () => Promise<{
          token: string;
          user: SessionUser;
          company: CompanySummary;
        }>,
      ),
    login: t.procedure
      .input(z.object({ email: z.string().email(), password: z.string() }))
      .mutation(
        notImplemented("auth.login") as () => Promise<{
          token: string;
          user: SessionUser;
          company: CompanySummary | null;
        }>,
      ),
    me: t.procedure.query(notImplemented("auth.me") as () => Promise<MeResult>),
    switchCompany: t.procedure
      .input(z.object({ companyId: z.string().uuid() }))
      .mutation(
        notImplemented("auth.switchCompany") as () => Promise<{
          companyId: string;
          role: MembershipRole;
        }>,
      ),
    logout: t.procedure.mutation(notImplemented("auth.logout") as () => Promise<{ ok: true }>),
  }),

  parts: t.router({
    list: t.procedure.query(notImplemented("parts.list") as () => Promise<Part[]>),
    search: t.procedure
      .input(z.object({ q: z.string().min(1) }))
      .query(notImplemented("parts.search") as () => Promise<Part[]>),
    getById: t.procedure
      .input(z.object({ id: z.string().uuid() }))
      .query(
        notImplemented("parts.getById") as () => Promise<{
          part: Part;
          revisions: PartRevision[];
        }>,
      ),
    create: t.procedure
      .input(CreatePartSchema)
      .mutation(
        notImplemented("parts.create") as () => Promise<{
          part: Part;
          revision: PartRevision;
        }>,
      ),
    listRevisions: t.procedure
      .input(z.object({ partId: z.string().uuid() }))
      .query(notImplemented("parts.listRevisions") as () => Promise<PartRevision[]>),
    getRevision: t.procedure
      .input(z.object({ revisionId: z.string().uuid() }))
      .query(
        notImplemented("parts.getRevision") as () => Promise<{
          revision: PartRevision;
          part: Part;
          dimensions: Dimension[];
        }>,
      ),
    getReleasedByPartNumber: t.procedure
      .input(z.object({ partNumber: z.string().min(1) }))
      .query(
        notImplemented("parts.getReleasedByPartNumber") as () => Promise<{
          part: Part;
          revision: PartRevision;
          dimensions: Dimension[];
        }>,
      ),
    releaseRevision: t.procedure
      .input(z.object({ revisionId: z.string().uuid() }))
      .mutation(notImplemented("parts.releaseRevision") as () => Promise<PartRevision>),
    branchRevision: t.procedure
      .input(z.object({ sourceRevisionId: z.string().uuid(), newRev: z.string().min(1).max(20) }))
      .mutation(notImplemented("parts.branchRevision") as () => Promise<PartRevision>),
    addDimension: t.procedure
      .input(CreateDimensionSchema)
      .mutation(notImplemented("parts.addDimension") as () => Promise<Dimension>),
    updateDimension: t.procedure
      .input(UpdateDimensionSchema)
      .mutation(notImplemented("parts.updateDimension") as () => Promise<Dimension>),
    deleteDimension: t.procedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(notImplemented("parts.deleteDimension") as () => Promise<{ ok: true }>),
  }),

  sheets: t.router({
    list: t.procedure
      .input(z.object({ status: z.enum(["in_progress", "completed", "abandoned"]).optional() }).optional())
      .query(notImplemented("sheets.list") as () => Promise<SheetListRow[]>),
    create: t.procedure
      .input(CreateDataSheetSchema)
      .mutation(
        notImplemented("sheets.create") as () => Promise<{
          sheet: DataSheet;
          dimensions: Dimension[];
          samplePlan: Array<{ dimensionId: string; sampleIndices: number[] }>;
        }>,
      ),
    getById: t.procedure
      .input(z.object({ id: z.string().uuid() }))
      .query(
        notImplemented("sheets.getById") as () => Promise<
          SheetDetail & { samplePlan: Array<{ dimensionId: string; sampleIndices: number[] }> }
        >,
      ),
    recordMeasurement: t.procedure
      .input(RecordMeasurementSchema)
      .mutation(notImplemented("sheets.recordMeasurement") as () => Promise<Measurement>),
    liveCapability: t.procedure
      .input(z.object({ sheetId: z.string().uuid() }))
      .query(
        notImplemented("sheets.liveCapability") as () => Promise<
          Array<{
            dimensionId: string;
            dimensionName: string;
            n: number;
            mean: number | null;
            stdDev: number | null;
            cp: number | null;
            cpk: number | null;
            percentYellow: number;
            percentRed: number;
          }>
        >,
      ),
    complete: t.procedure
      .input(z.object({ dataSheetId: z.string().uuid(), force: z.boolean().default(false) }))
      .mutation(
        notImplemented("sheets.complete") as () => Promise<{
          sheet: DataSheet;
          snapshots: unknown[];
        }>,
      ),
  }),

  dashboard: t.router({
    overview: t.procedure.query(
      notImplemented("dashboard.overview") as () => Promise<DashboardOverview>,
    ),
    partCapability: t.procedure
      .input(z.object({ partId: z.string().uuid() }))
      .query(notImplemented("dashboard.partCapability") as () => Promise<unknown>),
    recentEvents: t.procedure.query(
      notImplemented("dashboard.recentEvents") as () => Promise<unknown>,
    ),
  }),

  exports: t.router({
    generate: t.procedure
      .input(
        z.object({
          dataSheetId: z.string().uuid(),
          format: z.enum(["csv", "excel", "pdf"]),
        }),
      )
      .mutation(notImplemented("exports.generate") as () => Promise<ExportFileResult>),
  }),
});

export type AppRouter = typeof appRouter;
