/**
 * Database schema — Phase 1 operational slice.
 *
 * Conventions
 *  - Quantities: numeric(18,4) in the item's BASE unit unless a column says otherwise.
 *  - Money: numeric(18,2) in AED; unit prices/costs numeric(18,4).
 *  - Statuses are text + CHECK constraints (easier to evolve than Postgres enums).
 *  - Date-only business fields use `date` (Dubai local date); events use timestamptz (stored UTC).
 *  - stock_movements is an append-only ledger (enforced by a trigger in a custom migration).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  bigserial,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 18, scale: 4 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ───────────────────────────── Organisation & access ─────────────────────────────

export const organizationSettings = pgTable("organization_settings", {
  id: integer("id").primaryKey().default(1),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name").notNull(),
  trn: text("trn"),
  baseCurrency: text("base_currency").notNull().default("AED"),
  timezone: text("timezone").notNull().default("Asia/Dubai"),
  // "WAC" = moving weighted average cost. PROPOSED default, must be confirmed by the accountant.
  inventoryValuationMethod: text("inventory_valuation_method").notNull().default("WAC"),
  valuationMethodConfirmed: boolean("valuation_method_confirmed").notNull().default(false),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
}, (t) => [check("organization_settings_singleton", sql`${t.id} = 1`)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  jobTitle: text("job_title"),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
}, (t) => [unique("users_email_unique").on(t.email), check("users_email_lower", sql`${t.email} = lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  // SHA-256 hash of the random session token; the raw token only lives in the user's cookie.
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Company-wide roles (director, procurement, central stores) see every project.
  allProjects: boolean("all_projects").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(true),
}, (t) => [unique("roles_key_unique").on(t.key)]);

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
}, (t) => [primaryKey({ columns: [t.roleId, t.permission] })]);

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

// ───────────────────────────── Master data ─────────────────────────────

/** One record per external organisation; a company can be client AND supplier etc. */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  trn: text("trn"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isClient: boolean("is_client").notNull().default(false),
  isConsultant: boolean("is_consultant").notNull().default(false),
  isSupplier: boolean("is_supplier").notNull().default(false),
  isSubcontractor: boolean("is_subcontractor").notNull().default(false),
  paymentTerms: text("payment_terms"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [unique("companies_code_unique").on(t.code)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  clientCompanyId: uuid("client_company_id").references(() => companies.id),
  contractRef: text("contract_ref"),
  locationText: text("location_text"),
  plotNo: text("plot_no"),
  authorityJurisdiction: text("authority_jurisdiction"),
  status: text("status").notNull().default("active").$type<"planning" | "active" | "on_hold" | "completed" | "closed">(),
  startDate: date("start_date", { mode: "string" }),
  plannedEndDate: date("planned_end_date", { mode: "string" }),
  contractValue: money("contract_value"),
  createdAt: createdAt(),
}, (t) => [
  unique("projects_code_unique").on(t.code),
  check("projects_status_chk", sql`${t.status} in ('planning','active','on_hold','completed','closed')`),
]);

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  addedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_members_user_idx").on(t.userId)]);

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
}, (t) => [unique("sites_project_code_unique").on(t.projectId, t.code)]);

/** Stock locations. "transit" is a system location holding goods between dispatch and receipt. */
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().$type<"warehouse" | "site_store" | "transit">(),
  projectId: uuid("project_id").references(() => projects.id),
  siteId: uuid("site_id").references(() => sites.id),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  unique("locations_code_unique").on(t.code),
  check("locations_type_chk", sql`${t.type} in ('warehouse','site_store','transit')`),
  check("locations_site_store_project_chk", sql`${t.type} <> 'site_store' or ${t.projectId} is not null`),
]);

/** Company-wide cost code library shared by procurement, inventory, labour and cost reports. */
export const costCodes = pgTable("cost_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().$type<"material" | "labour" | "equipment" | "subcontract" | "overhead">(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [unique("cost_codes_code_unique").on(t.code)]);

export const units = pgTable("units", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  // Physical dimension. Conversions between different dimensions need an item-specific factor.
  dimension: text("dimension").notNull().$type<"count" | "length" | "area" | "volume" | "mass">(),
  // Factor to the dimension's reference unit (m, m2, m3, kg, l→m3 etc). Null for "count" packaging units.
  factorToReference: numeric("factor_to_reference", { precision: 24, scale: 10 }),
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  specification: text("specification"),
  brand: text("brand"),
  baseUnit: text("base_unit").notNull().references(() => units.code),
  purchaseUnit: text("purchase_unit").references(() => units.code),
  minStock: qty("min_stock"),
  reorderLevel: qty("reorder_level"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [unique("items_code_unique").on(t.code)]);

/** Item-specific packaging conversions, e.g. 1 bag of cement = 50 kg; 1 box = 20 pcs. */
export const itemUnitConversions = pgTable("item_unit_conversions", {
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  unitCode: text("unit_code").notNull().references(() => units.code),
  baseUnitsPerUnit: numeric("base_units_per_unit", { precision: 24, scale: 10 }).notNull(),
}, (t) => [primaryKey({ columns: [t.itemId, t.unitCode] }), check("iuc_positive", sql`${t.baseUnitsPerUnit} > 0`)]);

// ───────────────────────────── Numbering, audit, approvals ─────────────────────────────

export const documentSequences = pgTable("document_sequences", {
  key: text("key").primaryKey(),
  lastValue: integer("last_value").notNull().default(0),
});

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  projectId: uuid("project_id").references(() => projects.id),
  details: jsonb("details"),
  ip: text("ip"),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_project_idx").on(t.projectId)]);

export type ApprovalDocType = "material_request" | "purchase_order";

/** Configurable approval rules. Placeholder thresholds are seeded and MUST be confirmed by EDGE. */
export const approvalRules = pgTable("approval_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  docType: text("doc_type").notNull().$type<ApprovalDocType>(),
  projectId: uuid("project_id").references(() => projects.id),
  minAmount: money("min_amount").notNull().default("0"),
  maxAmount: money("max_amount"),
  // Ordered role keys; each step must be approved by a different person holding that role.
  stepRoleKeys: jsonb("step_role_keys").notNull().$type<string[]>(),
  allowSelfApproval: boolean("allow_self_approval").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  description: text("description"),
});

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  docType: text("doc_type").notNull().$type<ApprovalDocType>(),
  docId: uuid("doc_id").notNull(),
  docNumber: text("doc_number").notNull(),
  docRevision: integer("doc_revision").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  amount: money("amount"),
  ruleId: uuid("rule_id").references(() => approvalRules.id),
  status: text("status").notNull().$type<"pending" | "approved" | "rejected" | "superseded">(),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: ts("completed_at"),
}, (t) => [
  index("approval_requests_doc_idx").on(t.docType, t.docId),
  check("approval_requests_status_chk", sql`${t.status} in ('pending','approved','rejected','superseded')`),
]);

export const approvalSteps = pgTable("approval_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  stepNo: integer("step_no").notNull(),
  roleKey: text("role_key").notNull(),
  status: text("status").notNull().$type<"waiting" | "pending" | "approved" | "rejected" | "cancelled">(),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: ts("decided_at"),
  comment: text("comment"),
  // Records which document revision the decision applied to.
  docRevision: integer("doc_revision").notNull(),
}, (t) => [
  unique("approval_steps_request_step_unique").on(t.requestId, t.stepNo),
  check("approval_steps_status_chk", sql`${t.status} in ('waiting','pending','approved','rejected','cancelled')`),
  check("approval_steps_reject_reason", sql`${t.status} <> 'rejected' or coalesce(length(trim(${t.comment})),0) > 0`),
]);

// ───────────────────────────── Material requests ─────────────────────────────

export type MrStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled" | "closed";

export const materialRequests = pgTable("material_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  siteId: uuid("site_id").references(() => sites.id),
  requiredDate: date("required_date", { mode: "string" }).notNull(),
  status: text("status").notNull().$type<MrStatus>(),
  revision: integer("revision").notNull().default(0),
  version: integer("version").notNull().default(1),
  purpose: text("purpose"),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  submittedAt: ts("submitted_at"),
  approvedAt: ts("approved_at"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("material_requests_number_unique").on(t.number),
  index("material_requests_project_idx").on(t.projectId, t.status),
  check("material_requests_status_chk", sql`${t.status} in ('draft','pending_approval','approved','rejected','cancelled','closed')`),
]);

export const materialRequestLines = pgTable("material_request_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialRequestId: uuid("material_request_id").notNull().references(() => materialRequests.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id),
  qty: qty("qty").notNull(), // base unit
  costCodeId: uuid("cost_code_id").notNull().references(() => costCodes.id),
  remarks: text("remarks"),
}, (t) => [
  unique("mr_lines_line_no_unique").on(t.materialRequestId, t.lineNo),
  check("mr_lines_qty_positive", sql`${t.qty} > 0`),
]);

/** Stock earmarked at a location for a specific material-request line. */
export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => items.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  mrLineId: uuid("mr_line_id").notNull().references(() => materialRequestLines.id),
  qty: qty("qty").notNull(),
  qtyConsumed: qty("qty_consumed").notNull().default("0"),
  status: text("status").notNull().$type<"active" | "consumed" | "released">(),
  source: text("source").notNull().$type<"manual" | "receipt">(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("reservations_item_loc_idx").on(t.itemId, t.locationId, t.status),
  index("reservations_mr_line_idx").on(t.mrLineId),
  check("reservations_qty_positive", sql`${t.qty} > 0`),
  check("reservations_consumed_range", sql`${t.qtyConsumed} >= 0 and ${t.qtyConsumed} <= ${t.qty}`),
  check("reservations_status_chk", sql`${t.status} in ('active','consumed','released')`),
]);

// ───────────────────────────── Purchasing ─────────────────────────────

export type PoStatus =
  | "draft" | "pending_approval" | "approved" | "rejected" | "partially_received" | "received" | "closed" | "cancelled";

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  supplierId: uuid("supplier_id").notNull().references(() => companies.id),
  deliveryLocationId: uuid("delivery_location_id").notNull().references(() => locations.id),
  status: text("status").notNull().$type<PoStatus>(),
  revision: integer("revision").notNull().default(0),
  version: integer("version").notNull().default(1),
  currency: text("currency").notNull().default("AED"),
  requiredDate: date("required_date", { mode: "string" }),
  promisedDate: date("promised_date", { mode: "string" }),
  paymentTerms: text("payment_terms"),
  supplierQuoteRef: text("supplier_quote_ref"),
  notes: text("notes"),
  subtotal: money("subtotal").notNull().default("0"),
  vatAmount: money("vat_amount").notNull().default("0"),
  total: money("total").notNull().default("0"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  submittedAt: ts("submitted_at"),
  approvedAt: ts("approved_at"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("purchase_orders_number_unique").on(t.number),
  index("purchase_orders_project_idx").on(t.projectId, t.status),
  check("purchase_orders_status_chk", sql`${t.status} in ('draft','pending_approval','approved','rejected','partially_received','received','closed','cancelled')`),
]);

/**
 * VAT is chosen per line from a small code list; it is NOT applied blindly.
 * Rates are placeholders pending accountant validation (see docs/ASSUMPTIONS.md).
 */
export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id),
  mrLineId: uuid("mr_line_id").references(() => materialRequestLines.id),
  costCodeId: uuid("cost_code_id").notNull().references(() => costCodes.id),
  unitCode: text("unit_code").notNull().references(() => units.code),
  qty: qty("qty").notNull(), // in unit_code
  qtyBase: qty("qty_base").notNull(), // in item base unit
  unitPrice: rate("unit_price").notNull(), // per unit_code, excl. VAT
  vatCode: text("vat_code").notNull().$type<"SR" | "ZR" | "EX" | "OOS">(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
  lineNet: money("line_net").notNull(),
  lineVat: money("line_vat").notNull(),
  qtyCancelledBase: qty("qty_cancelled_base").notNull().default("0"),
}, (t) => [
  unique("po_lines_line_no_unique").on(t.purchaseOrderId, t.lineNo),
  index("po_lines_mr_line_idx").on(t.mrLineId),
  check("po_lines_qty_positive", sql`${t.qty} > 0 and ${t.qtyBase} > 0`),
  check("po_lines_price_nonneg", sql`${t.unitPrice} >= 0`),
  check("po_lines_vat_code_chk", sql`${t.vatCode} in ('SR','ZR','EX','OOS')`),
  check("po_lines_cancel_range", sql`${t.qtyCancelledBase} >= 0 and ${t.qtyCancelledBase} <= ${t.qtyBase}`),
]);

// ───────────────────────────── Inventory ─────────────────────────────

export type StockStatus = "available" | "quarantine" | "rejected" | "in_transit" | "discrepancy";

/** Running balance per item/location/status. Never negative (CHECK). Updated only with ledger postings. */
export const stockBalances = pgTable("stock_balances", {
  itemId: uuid("item_id").notNull().references(() => items.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  status: text("status").notNull().$type<StockStatus>(),
  qty: qty("qty").notNull().default("0"),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.locationId, t.status] }),
  check("stock_balances_nonnegative", sql`${t.qty} >= 0`),
  check("stock_balances_status_chk", sql`${t.status} in ('available','quarantine','rejected','in_transit','discrepancy')`),
]);

/** Company-wide moving average cost per item (PROPOSED valuation method). */
export const itemValuations = pgTable("item_valuations", {
  itemId: uuid("item_id").primaryKey().references(() => items.id),
  avgUnitCost: rate("avg_unit_cost").notNull().default("0"),
  valuedQty: qty("valued_qty").notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("item_valuations_nonneg", sql`${t.valuedQty} >= 0`)]);

export type MovementType =
  | "opening" | "receipt" | "receipt_rejected" | "issue" | "issue_return"
  | "transfer_dispatch" | "transfer_receipt" | "transfer_discrepancy" | "discrepancy_writeoff" | "discrepancy_found"
  | "adjustment" | "reversal";

/** Append-only stock ledger. Corrections are new rows (reversal/adjustment), never edits. */
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  movementType: text("movement_type").notNull().$type<MovementType>(),
  itemId: uuid("item_id").notNull().references(() => items.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  status: text("status").notNull().$type<StockStatus>(),
  qtyDelta: qty("qty_delta").notNull(), // signed, base unit
  unitCost: rate("unit_cost").notNull().default("0"),
  valueDelta: money("value_delta").notNull().default("0"),
  projectId: uuid("project_id").references(() => projects.id),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  sourceLineId: uuid("source_line_id"),
  sourceNumber: text("source_number").notNull(),
  movementDate: date("movement_date", { mode: "string" }).notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  postedBy: uuid("posted_by").notNull().references(() => users.id),
  note: text("note"),
}, (t) => [
  unique("stock_movements_seq_unique").on(t.seq),
  index("stock_movements_item_loc_idx").on(t.itemId, t.locationId),
  index("stock_movements_project_idx").on(t.projectId),
  index("stock_movements_source_idx").on(t.sourceType, t.sourceId),
  check("stock_movements_nonzero", sql`${t.qtyDelta} <> 0`),
]);

export const goodsReceipts = pgTable("goods_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  deliveryNoteRef: text("delivery_note_ref"),
  receivedDate: date("received_date", { mode: "string" }).notNull(),
  receivedBy: uuid("received_by").notNull().references(() => users.id),
  notes: text("notes"),
  idempotencyKey: text("idempotency_key").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("goods_receipts_number_unique").on(t.number),
  unique("goods_receipts_idem_unique").on(t.idempotencyKey),
  index("goods_receipts_po_idx").on(t.purchaseOrderId),
]);

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  poLineId: uuid("po_line_id").notNull().references(() => purchaseOrderLines.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  qtyReceivedBase: qty("qty_received_base").notNull(),
  qtyAcceptedBase: qty("qty_accepted_base").notNull(),
  qtyRejectedBase: qty("qty_rejected_base").notNull(),
  rejectionReason: text("rejection_reason"),
  unitCostBase: rate("unit_cost_base").notNull(),
}, (t) => [
  index("grn_lines_po_line_idx").on(t.poLineId),
  check("grn_lines_split", sql`${t.qtyAcceptedBase} >= 0 and ${t.qtyRejectedBase} >= 0 and ${t.qtyAcceptedBase} + ${t.qtyRejectedBase} = ${t.qtyReceivedBase} and ${t.qtyReceivedBase} > 0`),
  check("grn_lines_reject_reason", sql`${t.qtyRejectedBase} = 0 or coalesce(length(trim(${t.rejectionReason})),0) > 0`),
]);

export const stockIssues = pgTable("stock_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  siteId: uuid("site_id").references(() => sites.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  issuedTo: text("issued_to").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  issuedBy: uuid("issued_by").notNull().references(() => users.id),
  notes: text("notes"),
  idempotencyKey: text("idempotency_key").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("stock_issues_number_unique").on(t.number),
  unique("stock_issues_idem_unique").on(t.idempotencyKey),
  index("stock_issues_project_idx").on(t.projectId),
]);

export const stockIssueLines = pgTable("stock_issue_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockIssueId: uuid("stock_issue_id").notNull().references(() => stockIssues.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id),
  mrLineId: uuid("mr_line_id").references(() => materialRequestLines.id),
  costCodeId: uuid("cost_code_id").notNull().references(() => costCodes.id),
  qtyBase: qty("qty_base").notNull(),
  unitCost: rate("unit_cost").notNull(),
  value: money("value").notNull(),
}, (t) => [
  index("stock_issue_lines_mr_line_idx").on(t.mrLineId),
  check("stock_issue_lines_qty_positive", sql`${t.qtyBase} > 0`),
]);

export const stockTransfers = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
  fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
  toLocationId: uuid("to_location_id").notNull().references(() => locations.id),
  status: text("status").notNull().$type<"in_transit" | "received" | "received_with_discrepancy">(),
  dispatchDate: date("dispatch_date", { mode: "string" }).notNull(),
  dispatchedBy: uuid("dispatched_by").notNull().references(() => users.id),
  receivedDate: date("received_date", { mode: "string" }),
  receivedBy: uuid("received_by").references(() => users.id),
  vehicleRef: text("vehicle_ref"),
  notes: text("notes"),
  idempotencyKey: text("idempotency_key").notNull(),
  receiveIdempotencyKey: text("receive_idempotency_key"),
  createdAt: createdAt(),
}, (t) => [
  unique("stock_transfers_number_unique").on(t.number),
  unique("stock_transfers_idem_unique").on(t.idempotencyKey),
  unique("stock_transfers_recv_idem_unique").on(t.receiveIdempotencyKey),
  check("stock_transfers_distinct", sql`${t.fromLocationId} <> ${t.toLocationId}`),
  check("stock_transfers_status_chk", sql`${t.status} in ('in_transit','received','received_with_discrepancy')`),
]);

export const stockTransferLines = pgTable("stock_transfer_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockTransferId: uuid("stock_transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id),
  // Optional: the material-request line this stock is being moved for (its reservation travels with it).
  mrLineId: uuid("mr_line_id").references(() => materialRequestLines.id),
  qtyDispatched: qty("qty_dispatched").notNull(),
  qtyReceived: qty("qty_received"),
  qtyDiscrepancy: qty("qty_discrepancy"),
  discrepancyStatus: text("discrepancy_status").notNull().default("none").$type<"none" | "open" | "written_off" | "found">(),
  discrepancyNote: text("discrepancy_note"),
  discrepancyResolvedBy: uuid("discrepancy_resolved_by").references(() => users.id),
  discrepancyResolvedAt: ts("discrepancy_resolved_at"),
}, (t) => [
  check("stl_qty_positive", sql`${t.qtyDispatched} > 0`),
  check("stl_received_range", sql`${t.qtyReceived} is null or (${t.qtyReceived} >= 0 and ${t.qtyReceived} + coalesce(${t.qtyDiscrepancy},0) = ${t.qtyDispatched})`),
  check("stl_discrepancy_status_chk", sql`${t.discrepancyStatus} in ('none','open','written_off','found')`),
]);
