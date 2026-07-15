/**
 * Shared DTO / domain interfaces used by web pages and components.
 *
 * The live tRPC `AppRouter` type is imported from `@datasheets/api/router`
 * (types-only export) in `src/lib/trpc.ts` — this file no longer mirrors
 * the router with a hand-maintained stub.
 */
import type {
  Disposition,
  MembershipRole,
  RevisionStatus,
  SheetStatus,
  FrequencyType,
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
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface PartRevision {
  id: string;
  companyId: string;
  partId: string;
  rev: string;
  status: RevisionStatus;
  notes: string | null;
  releasedAt: string | Date | null;
  releasedBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
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
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface DataSheet {
  id: string;
  companyId: string;
  partRevisionId: string;
  lotNumber: string;
  lotSize: number;
  status: SheetStatus;
  operatorId: string | null;
  completedAt: string | Date | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface Measurement {
  id: string;
  dataSheetId: string;
  dimensionId: string;
  sampleIndex: number;
  value: number;
  disposition: Disposition;
  measuredBy: string | null;
  measuredAt: string | Date;
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
