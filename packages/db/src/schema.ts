import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const membershipRoleEnum = pgEnum("membership_role", [
  "operator",
  "engineer",
  "admin",
  "quality",
]);

export const revisionStatusEnum = pgEnum("revision_status", [
  "draft",
  "released",
  "superseded",
]);

export const sheetStatusEnum = pgEnum("sheet_status", [
  "in_progress",
  "completed",
  "abandoned",
]);

export const frequencyTypeEnum = pgEnum("frequency_type", [
  "every_n_parts",
  "sample_size_per_lot",
]);

export const dispositionEnum = pgEnum("disposition", [
  "green",
  "yellow",
  "red",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "drw",
  "pro",
  "wi",
  "frm",
]);

export const documentRevisionStatusEnum = pgEnum("document_revision_status", [
  "draft",
  "in_review",
  "released",
  "superseded",
  "obsolete",
]);

export const signatureMeaningEnum = pgEnum("signature_meaning", [
  "me_approval",
  "qa_approval",
  "disposition",
  "closure",
  "change_approval_me",
  "change_approval_qa",
]);

export const changeOrderStatusEnum = pgEnum("change_order_status", [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "implemented",
]);

export const fileKindEnum = pgEnum("file_kind", [
  "pdf",
  "cad",
  "image",
  "other",
]);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings")
    .$type<{
      defaultWarningFraction?: number;
      defaultUnit?: string;
    }>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Auth users — better-auth compatible shape, no company_id (user can join multiple).
 * Global identity store: FORCE RLS with open datasheets_app policies (login by email).
 * Not tenant-isolated by company_id; isolation is via memberships + tenant tables.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    image: text("image"),
    emailVerificationToken: text("email_verification_token"),
    emailVerificationExpires: timestamp("email_verification_expires", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_verification_token_uidx")
      .on(t.emailVerificationToken)
      .where(sql`${t.emailVerificationToken} IS NOT NULL`),
  ],
);

/**
 * Sessions — global (FORCE RLS, open datasheets_app policies for token lookup).
 * Prefer hashed tokens at rest; RLS alone does not scope sessions per tenant.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  /** Active company context for the session (tenant switch) */
  activeCompanyId: uuid("active_company_id").references(() => companies.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("operator"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("memberships_company_user_uidx").on(t.companyId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const parts = pgTable(
  "parts",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partNumber: text("part_number").notNull(),
    description: text("description"),
    customer: text("customer"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("parts_company_pn_uidx").on(t.companyId, t.partNumber),
  ],
);

export const partRevisions = pgTable(
  "part_revisions",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    partId: uuid("part_id").notNull(),
    rev: text("rev").notNull(),
    status: revisionStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("part_revisions_company_part_rev_uidx").on(
      t.companyId,
      t.partId,
      t.rev,
    ),
    uniqueIndex("part_revisions_one_released_uq")
      .on(t.companyId, t.partId)
      .where(sql`${t.status} = 'released'`),
    index("part_revisions_part_idx").on(t.companyId, t.partId),
  ],
);

export const dimensions = pgTable(
  "dimensions",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    partRevisionId: uuid("part_revision_id").notNull(),
    name: text("name").notNull(),
    balloonNumber: text("balloon_number"),
    unit: text("unit").notNull().default("in"),
    nominal: doublePrecision("nominal").notNull(),
    usl: doublePrecision("usl"),
    lsl: doublePrecision("lsl"),
    warningFraction: doublePrecision("warning_fraction").notNull().default(0.75),
    gageMethod: text("gage_method"),
    frequencyType: frequencyTypeEnum("frequency_type")
      .notNull()
      .default("every_n_parts"),
    frequencyN: integer("frequency_n").notNull().default(1),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("dimensions_revision_idx").on(t.companyId, t.partRevisionId),
    check(
      "dimensions_has_limit",
      sql`${t.usl} IS NOT NULL OR ${t.lsl} IS NOT NULL`,
    ),
    check(
      "dimensions_warning_fraction",
      sql`${t.warningFraction} >= 0 AND ${t.warningFraction} <= 1`,
    ),
  ],
);

export const dataSheets = pgTable(
  "data_sheets",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    partRevisionId: uuid("part_revision_id").notNull(),
    lotNumber: text("lot_number").notNull(),
    lotSize: integer("lot_size").notNull(),
    status: sheetStatusEnum("status").notNull().default("in_progress"),
    operatorId: uuid("operator_id").references(() => users.id),
    /** Optional link to MES work-order operation (nullable; standalone sheets OK) */
    workOrderOperationId: uuid("work_order_operation_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("data_sheets_lot_uq").on(
      t.companyId,
      t.partRevisionId,
      t.lotNumber,
    ),
    index("data_sheets_revision_idx").on(t.companyId, t.partRevisionId),
    index("data_sheets_status_idx").on(t.companyId, t.status),
    index("data_sheets_woo_idx").on(t.companyId, t.workOrderOperationId),
    check("data_sheets_lot_size_positive", sql`${t.lotSize} > 0`),
    check("data_sheets_lot_size_max", sql`${t.lotSize} <= 10000`),
  ],
);

/**
 * Measurements are append-only for auditability.
 * Corrections set superseded_by on the old row and insert a new one.
 */
export const measurements = pgTable(
  "measurements",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    dataSheetId: uuid("data_sheet_id").notNull(),
    dimensionId: uuid("dimension_id").notNull(),
    sampleIndex: integer("sample_index").notNull(),
    value: doublePrecision("value").notNull(),
    disposition: dispositionEnum("disposition").notNull(),
    measuredBy: uuid("measured_by").references(() => users.id),
    measuredAt: timestamp("measured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null = current active measurement for (sheet, dim, sample) */
    supersededBy: uuid("superseded_by"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("measurements_one_current_uq")
      .on(t.companyId, t.dataSheetId, t.dimensionId, t.sampleIndex)
      .where(sql`${t.isCurrent} = true`),
    index("measurements_sheet_idx").on(t.companyId, t.dataSheetId),
    index("measurements_current_idx").on(
      t.companyId,
      t.dataSheetId,
      t.dimensionId,
      t.sampleIndex,
      t.isCurrent,
    ),
    check("measurements_sample_index_nonneg", sql`${t.sampleIndex} >= 0`),
  ],
);

export const capabilitySnapshots = pgTable(
  "capability_snapshots",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    dataSheetId: uuid("data_sheet_id").notNull(),
    dimensionId: uuid("dimension_id").notNull(),
    partId: uuid("part_id").notNull(),
    n: integer("n").notNull(),
    mean: doublePrecision("mean"),
    stdDev: doublePrecision("std_dev"),
    cp: doublePrecision("cp"),
    cpk: doublePrecision("cpk"),
    percentYellow: doublePrecision("percent_yellow").notNull().default(0),
    percentRed: doublePrecision("percent_red").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("capability_part_idx").on(t.companyId, t.partId),
    index("capability_dimension_idx").on(t.companyId, t.dimensionId),
    uniqueIndex("capability_sheet_dim_uidx").on(
      t.companyId,
      t.dataSheetId,
      t.dimensionId,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("audit_logs_created_idx").on(t.companyId, t.createdAt),
  ],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    dataSheetId: uuid("data_sheet_id").notNull(),
    format: text("format").notNull(), // csv | excel | pdf
    status: text("status").notNull().default("pending"),
    requestedBy: uuid("requested_by").references(() => users.id),
    fileName: text("file_name"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("export_jobs_sheet_idx").on(t.companyId, t.dataSheetId),
  ],
);

// ---------------------------------------------------------------------------
// QMS / controlled documents
// ---------------------------------------------------------------------------

export const files = pgTable(
  "files",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes"),
    mimeType: text("mime_type"),
    kind: fileKindEnum("kind"),
    originalName: text("original_name"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("files_sha256_idx").on(t.companyId, t.sha256),
  ],
);

export const numberCounters = pgTable(
  "number_counters",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Prefix for document numbering, e.g. DRW, PRO, WI, FRM, CO */
    prefix: text("prefix").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.prefix] })],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    docNumber: text("doc_number").notNull(),
    docType: documentTypeEnum("doc_type").notNull(),
    title: text("title"),
    partId: uuid("part_id"),
    /** Optional link to the FRM that originated this document */
    sourceFrmId: uuid("source_frm_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("documents_company_doc_number_uidx").on(
      t.companyId,
      t.docNumber,
    ),
    index("documents_part_idx").on(t.companyId, t.partId),
    index("documents_type_idx").on(t.companyId, t.docType),
  ],
);

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    documentId: uuid("document_id").notNull(),
    rev: text("rev").notNull(),
    status: documentRevisionStatusEnum("status").notNull().default("draft"),
    googleFileId: text("google_file_id"),
    pdfFileId: uuid("pdf_file_id"),
    cadFileId: uuid("cad_file_id"),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").references(() => users.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("document_revisions_company_doc_rev_uidx").on(
      t.companyId,
      t.documentId,
      t.rev,
    ),
    uniqueIndex("document_revisions_one_released_uq")
      .on(t.companyId, t.documentId)
      .where(sql`${t.status} = 'released'`),
    index("document_revisions_document_idx").on(t.companyId, t.documentId),
    index("document_revisions_status_idx").on(t.companyId, t.status),
  ],
);

/**
 * Electronic signatures — immutable audit records.
 * No updated_at; app role has SELECT/INSERT only (no UPDATE/DELETE).
 */
export const signatures = pgTable(
  "signatures",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    meaning: signatureMeaningEnum("meaning").notNull(),
    signerId: uuid("signer_id")
      .notNull()
      .references(() => users.id),
    /** Snapshot of signer display name at signing time */
    signerName: text("signer_name").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    contentSha256: text("content_sha256").notNull(),
    passwordVerified: boolean("password_verified").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("signatures_entity_idx").on(
      t.companyId,
      t.entityType,
      t.entityId,
    ),
    index("signatures_signed_at_idx").on(t.companyId, t.signedAt),
  ],
);

export const changeOrders = pgTable(
  "change_orders",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    coNumber: text("co_number").notNull(),
    title: text("title"),
    description: text("description").notNull(),
    reason: text("reason").notNull(),
    status: changeOrderStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    implementedAt: timestamp("implemented_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("change_orders_company_co_number_uidx").on(
      t.companyId,
      t.coNumber,
    ),
    index("change_orders_status_idx").on(t.companyId, t.status),
  ],
);

export const changeOrderItems = pgTable(
  "change_order_items",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    changeOrderId: uuid("change_order_id").notNull(),
    /** Exactly one of documentRevisionId / routingRevisionId must be set (SQL CHECK) */
    documentRevisionId: uuid("document_revision_id"),
    routingRevisionId: uuid("routing_revision_id"),
    notes: text("notes"),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("change_order_items_co_doc_rev_uidx")
      .on(t.companyId, t.changeOrderId, t.documentRevisionId)
      .where(sql`${t.documentRevisionId} IS NOT NULL`),
    uniqueIndex("change_order_items_co_rtg_rev_uidx")
      .on(t.companyId, t.changeOrderId, t.routingRevisionId)
      .where(sql`${t.routingRevisionId} IS NOT NULL`),
    index("change_order_items_co_idx").on(t.companyId, t.changeOrderId),
  ],
);

/** One Google Drive connection per company */
export const googleConnections = pgTable("google_connections", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accountEmail: text("account_email"),
  rootFolderId: text("root_folder_id"),
  /** Subfolder IDs keyed by document type / purpose */
  folders: jsonb("folders").$type<Record<string, string>>().default({}),
  connectedBy: uuid("connected_by").references(() => users.id),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Short-lived Google OAuth CSRF state — global (FORCE RLS, open datasheets_app
 * policies). Consumed on callback before tenant GUC is set.
 */
export const oauthStates = pgTable("oauth_states", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  state: text("state").notNull().unique(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type PartRevision = typeof partRevisions.$inferSelect;
export type Dimension = typeof dimensions.$inferSelect;
export type DataSheet = typeof dataSheets.$inferSelect;
export type Measurement = typeof measurements.$inferSelect;
export type CapabilitySnapshot = typeof capabilitySnapshots.$inferSelect;
export type File = typeof files.$inferSelect;
export type NumberCounter = typeof numberCounters.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentRevision = typeof documentRevisions.$inferSelect;
export type Signature = typeof signatures.$inferSelect;
export type ChangeOrder = typeof changeOrders.$inferSelect;
export type ChangeOrderItem = typeof changeOrderItems.$inferSelect;
export type GoogleConnection = typeof googleConnections.$inferSelect;
export type OAuthState = typeof oauthStates.$inferSelect;
