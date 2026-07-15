/**
 * Phase 2 MES — routings, work orders, append-only executions.
 * Wired via packages/db/src/index.ts + drizzle/0009_mes_routings.sql
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, users, revisionStatusEnum } from "./schema.js";

/**
 * MES work-order lifecycle.
 * planned → released → in_progress → (on_hold) → completed → closed
 * cancelled from non-terminal states.
 */
export const workOrderStatusEnum = pgEnum("work_order_status", [
  "planned",
  "released",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
  "cancelled",
]);

export const woOpDocumentRoleEnum = pgEnum("wo_op_document_role", [
  "wi",
  "drawing",
  "procedure",
]);

// ---------------------------------------------------------------------------
// Routings
// ---------------------------------------------------------------------------

export const routings = pgTable(
  "routings",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partId: uuid("part_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("routings_part_idx").on(t.companyId, t.partId),
  ],
);

export const routingRevisions = pgTable(
  "routing_revisions",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    routingId: uuid("routing_id").notNull(),
    rev: text("rev").notNull(),
    status: revisionStatusEnum("status").notNull().default("draft"),
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
    uniqueIndex("routing_revisions_company_routing_rev_uidx").on(
      t.companyId,
      t.routingId,
      t.rev,
    ),
    uniqueIndex("routing_revisions_one_released_uq")
      .on(t.companyId, t.routingId)
      .where(sql`${t.status} = 'released'`),
    index("routing_revisions_routing_idx").on(t.companyId, t.routingId),
    index("routing_revisions_status_idx").on(t.companyId, t.status),
  ],
);

export const routingOperations = pgTable(
  "routing_operations",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    routingRevisionId: uuid("routing_revision_id").notNull(),
    opNumber: integer("op_number").notNull(),
    name: text("name").notNull(),
    workCenter: text("work_center"),
    /** Link to WI document header — resolve current released rev at op start */
    wiDocumentId: uuid("wi_document_id"),
    requiresDataSheet: boolean("requires_data_sheet").notNull().default(false),
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
    uniqueIndex("routing_operations_rev_op_uidx").on(
      t.companyId,
      t.routingRevisionId,
      t.opNumber,
    ),
    index("routing_operations_revision_idx").on(
      t.companyId,
      t.routingRevisionId,
    ),
    check("routing_operations_op_number_positive", sql`${t.opNumber} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    woNumber: text("wo_number").notNull(),
    partId: uuid("part_id").notNull(),
    partRevisionId: uuid("part_revision_id").notNull(),
    routingRevisionId: uuid("routing_revision_id").notNull(),
    qty: integer("qty").notNull(),
    lotNumber: text("lot_number"),
    status: workOrderStatusEnum("status").notNull().default("planned"),
    createdBy: uuid("created_by").references(() => users.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id),
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
    uniqueIndex("work_orders_company_wo_number_uidx").on(
      t.companyId,
      t.woNumber,
    ),
    index("work_orders_part_idx").on(t.companyId, t.partId),
    index("work_orders_status_idx").on(t.companyId, t.status),
    index("work_orders_lot_idx").on(t.companyId, t.lotNumber),
    check("work_orders_qty_positive", sql`${t.qty} > 0`),
    check("work_orders_qty_max", sql`${t.qty} <= 100000`),
  ],
);

/**
 * Per-op execution state. qty_complete / qty_scrap are derived aggregates
 * updated in the same transaction as operation_executions inserts.
 */
export const workOrderOperations = pgTable(
  "work_order_operations",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    routingOperationId: uuid("routing_operation_id").notNull(),
    qtyComplete: integer("qty_complete").notNull().default(0),
    qtyScrap: integer("qty_scrap").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    startedBy: uuid("started_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    /** Display metadata captured at start (doc numbers, titles) */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("work_order_operations_wo_rop_uidx").on(
      t.companyId,
      t.workOrderId,
      t.routingOperationId,
    ),
    index("work_order_operations_wo_idx").on(t.companyId, t.workOrderId),
    check("work_order_operations_qty_complete_nonneg", sql`${t.qtyComplete} >= 0`),
    check("work_order_operations_qty_scrap_nonneg", sql`${t.qtyScrap} >= 0`),
  ],
);

/**
 * Append-only execution ledger — who did how many parts when.
 * Corrections insert adjustment rows; never UPDATE/DELETE.
 */
export const operationExecutions = pgTable(
  "operation_executions",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    workOrderOperationId: uuid("work_order_operation_id").notNull(),
    qtyGood: integer("qty_good").notNull().default(0),
    qtyScrap: integer("qty_scrap").notNull().default(0),
    performedBy: uuid("performed_by")
      .notNull()
      .references(() => users.id),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
    /** Required when this row is a correction / negative adjustment */
    reason: text("reason"),
    dataSheetId: uuid("data_sheet_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("operation_executions_woo_idx").on(
      t.companyId,
      t.workOrderOperationId,
    ),
    index("operation_executions_performed_idx").on(
      t.companyId,
      t.performedAt,
    ),
  ],
);

/**
 * Frozen controlled-document revisions in effect when an op started.
 * FK-enforced DHR evidence (which WI/drawing rev was used).
 */
export const workOrderOperationDocuments = pgTable(
  "work_order_operation_documents",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    companyId: uuid("company_id").notNull(),
    workOrderOperationId: uuid("work_order_operation_id").notNull(),
    documentId: uuid("document_id").notNull(),
    documentRevisionId: uuid("document_revision_id").notNull(),
    role: woOpDocumentRoleEnum("role").notNull(),
    /** Display snapshot: docNumber, title, rev letter at capture */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex("wo_op_docs_woo_role_uidx").on(
      t.companyId,
      t.workOrderOperationId,
      t.role,
      t.documentId,
    ),
    index("wo_op_docs_woo_idx").on(t.companyId, t.workOrderOperationId),
  ],
);

export type Routing = typeof routings.$inferSelect;
export type RoutingRevision = typeof routingRevisions.$inferSelect;
export type RoutingOperation = typeof routingOperations.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type WorkOrderOperation = typeof workOrderOperations.$inferSelect;
export type OperationExecution = typeof operationExecutions.$inferSelect;
export type WorkOrderOperationDocument =
  typeof workOrderOperationDocuments.$inferSelect;
