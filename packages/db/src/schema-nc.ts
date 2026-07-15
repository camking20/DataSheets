/**
 * Phase 4 NC / CAPA schema.
 * Wired via packages/db/src/index.ts + drizzle/0010_nc_capa.sql
 *
 * Note: measurement `disposition` (green|yellow|red) is unrelated;
 * NC material disposition uses `nc_disposition`.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  companies,
  users,
  parts,
  dataSheets,
  signatures,
} from "./schema.js";
import { workOrders, workOrderOperations } from "./schema-mes.js";

export const ncStatusEnum = pgEnum("nc_status", [
  "initiation",
  "containment",
  "disposition_planning",
  "disposition_execution",
  "investigation",
  "closure",
]);

export const ncDispositionEnum = pgEnum("nc_disposition", [
  "use_as_is",
  "rework",
  "repair",
  "scrap",
  "return_to_vendor",
]);

export const ncTriageDecisionEnum = pgEnum("nc_triage_decision", [
  "acceptable",
  "nc",
  "nc_capa",
]);

export const capaStatusEnum = pgEnum("capa_status", [
  "open",
  "in_progress",
  "verification",
  "closed",
]);

export const capaActionStatusEnum = pgEnum("capa_action_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const nonconformances = pgTable(
  "nonconformances",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ncNumber: text("nc_number").notNull(),
    status: ncStatusEnum("status").notNull().default("initiation"),
    title: text("title"),
    description: text("description").notNull(),
    isAcceptable: boolean("is_acceptable").notNull().default(false),
    capaRequired: boolean("capa_required").notNull().default(false),
    partId: uuid("part_id"),
    dataSheetId: uuid("data_sheet_id"),
    workOrderId: uuid("work_order_id"),
    workOrderOperationId: uuid("work_order_operation_id"),
    quantityAffected: integer("quantity_affected"),
    flaggedQty: integer("flagged_qty"),
    severity: text("severity"),
    triageDecision: ncTriageDecisionEnum("triage_decision"),
    triagedBy: uuid("triaged_by").references(() => users.id),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    disposition: ncDispositionEnum("disposition"),
    dispositionNotes: text("disposition_notes"),
    containmentActions: text("containment_actions"),
    rootCause: text("root_cause"),
    riskAnalysis: text("risk_analysis"),
    createdBy: uuid("created_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("nonconformances_company_nc_number_uidx").on(
      t.companyId,
      t.ncNumber,
    ),
    index("nonconformances_status_idx").on(t.companyId, t.status),
    index("nonconformances_part_idx").on(t.companyId, t.partId),
    index("nonconformances_wo_idx").on(t.companyId, t.workOrderId),
    foreignKey({
      columns: [t.companyId, t.partId],
      foreignColumns: [parts.companyId, parts.id],
    }),
    foreignKey({
      columns: [t.companyId, t.dataSheetId],
      foreignColumns: [dataSheets.companyId, dataSheets.id],
    }),
    foreignKey({
      columns: [t.companyId, t.workOrderId],
      foreignColumns: [workOrders.companyId, workOrders.id],
    }),
    foreignKey({
      columns: [t.companyId, t.workOrderOperationId],
      foreignColumns: [workOrderOperations.companyId, workOrderOperations.id],
    }),
  ],
);

/**
 * Append-only NC timeline. No updated_at; SELECT + INSERT only for app role.
 */
export const ncEvents = pgTable(
  "nc_events",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nonconformanceId: uuid("nonconformance_id").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: ncStatusEnum("from_status"),
    toStatus: ncStatusEnum("to_status"),
    actorId: uuid("actor_id").references(() => users.id),
    note: text("note"),
    signatureId: uuid("signature_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("nc_events_nc_idx").on(t.companyId, t.nonconformanceId),
    index("nc_events_created_idx").on(t.companyId, t.createdAt),
    foreignKey({
      columns: [t.companyId, t.nonconformanceId],
      foreignColumns: [nonconformances.companyId, nonconformances.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.companyId, t.signatureId],
      foreignColumns: [signatures.companyId, signatures.id],
    }),
  ],
);

export const capas = pgTable(
  "capas",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    capaNumber: text("capa_number").notNull(),
    nonconformanceId: uuid("nonconformance_id"),
    title: text("title"),
    description: text("description").notNull(),
    status: capaStatusEnum("status").notNull().default("open"),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action"),
    preventiveAction: text("preventive_action"),
    riskAssessment: text("risk_assessment"),
    effectivenessCheck: text("effectiveness_check"),
    effectivenessVerifiedBy: uuid("effectiveness_verified_by").references(
      () => users.id,
    ),
    effectivenessVerifiedAt: timestamp("effectiveness_verified_at", {
      withTimezone: true,
    }),
    createdBy: uuid("created_by").references(() => users.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("capas_company_capa_number_uidx").on(t.companyId, t.capaNumber),
    index("capas_status_idx").on(t.companyId, t.status),
    index("capas_nc_idx").on(t.companyId, t.nonconformanceId),
    index("capas_due_idx").on(t.companyId, t.dueAt),
    foreignKey({
      columns: [t.companyId, t.nonconformanceId],
      foreignColumns: [nonconformances.companyId, nonconformances.id],
    }),
  ],
);

export const capaActions = pgTable(
  "capa_actions",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    capaId: uuid("capa_id").notNull(),
    description: text("description").notNull(),
    actionType: text("action_type"),
    status: capaActionStatusEnum("status").notNull().default("pending"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("capa_actions_capa_idx").on(t.companyId, t.capaId),
    index("capa_actions_status_idx").on(t.companyId, t.status),
    foreignKey({
      columns: [t.companyId, t.capaId],
      foreignColumns: [capas.companyId, capas.id],
    }).onDelete("cascade"),
  ],
);

export type Nonconformance = typeof nonconformances.$inferSelect;
export type NcEvent = typeof ncEvents.$inferSelect;
export type Capa = typeof capas.$inferSelect;
export type CapaAction = typeof capaActions.$inferSelect;
