/**
 * HTTP API. Every handler authorises on the server (permission + project scope) inside the
 * service it calls; hiding buttons in the UI is never relied on. See docs/ARCHITECTURE.md → API.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db/client.js";
import {
  auditEvents, companies, costCodes, itemUnitConversions, items, locations, projects, roles, sites, units, userRoles, users, projectMembers,
} from "./db/schema.js";
import { type Actor, canAccessProject, projectScope, requirePerm, requireProject } from "./auth/actor.js";
import { audit } from "./lib/audit.js";
import { toCsv } from "./lib/csv.js";
import { isIsoDate } from "./lib/dates.js";
import { notFound, rule } from "./lib/errors.js";
import { VAT_CODES, VAT_VERIFIED } from "./lib/vat.js";
import { decide, myPendingApprovals } from "./services/approvals.js";
import * as inv from "./services/inventory.js";
import * as mr from "./services/materialRequests.js";
import * as po from "./services/purchasing.js";
import { dashboard, drillRows, projectDrill, projectReport } from "./services/reports.js";
import * as sub from "./services/submittals.js";
import * as sr from "./services/siteReports.js";
import { addProgressUpdate, overview, progressHistory } from "./services/overview.js";

const uuid = z.string().uuid();
const decimalStr = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Must be a number");
const isoDate = z.string().refine(isIsoDate, "Must be a date (YYYY-MM-DD)");
const optText = z.string().trim().max(2000).nullish();
const page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const idParam = z.object({ id: uuid });

const mrLine = z.object({ itemId: uuid, qty: decimalStr, costCodeId: uuid, remarks: optText });
const mrBody = z.object({ projectId: uuid, siteId: uuid.nullish(), requiredDate: isoDate, purpose: optText, lines: z.array(mrLine).min(1).max(200) });
const poLine = z.object({
  itemId: uuid, mrLineId: uuid.nullish(), costCodeId: uuid, unitCode: z.string().min(1), qty: decimalStr, unitPrice: decimalStr,
  vatCode: z.enum(Object.keys(VAT_CODES) as [keyof typeof VAT_CODES]),
});
const poBody = z.object({
  projectId: uuid, supplierId: uuid, deliveryLocationId: uuid, requiredDate: isoDate.nullish(), promisedDate: isoDate.nullish(),
  paymentTerms: optText, supplierQuoteRef: optText, notes: optText, lines: z.array(poLine).min(1).max(200),
});
const idemKey = z.string().min(8).max(100);

const submittalBody = z.object({
  projectId: uuid, type: z.enum(sub.SUBMITTAL_TYPES), title: z.string().trim().min(1).max(300), discipline: z.enum(sub.DISCIPLINES),
  specSection: optText, area: optText, subcontractorId: uuid.nullish(), consultantId: uuid.nullish(), requiredBy: isoDate.nullish(),
  itemIds: z.array(uuid).max(50).default([]),
});
const siteReportBody = z.object({
  projectId: uuid, siteId: uuid.nullish(), reportDate: isoDate, weather: optText, workDone: z.string().trim().max(5000), issues: optText,
  delayCause: z.enum(sr.DELAY_CAUSES).nullish(), inspections: optText, visitors: optText,
  safetyIncidents: z.number().int().min(0).max(100).default(0), safetyNotes: optText,
  manpower: z.array(z.object({ trade: z.string().trim().min(1).max(100), companyId: uuid.nullish(), headcount: z.number().int().min(1).max(5000) })).max(100),
});

const actorOf = (req: { actor: Actor | null }) => req.actor!;

function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`)
    .send(csv);
}

export async function registerRoutes(app: FastifyInstance, db: DB) {
  // ───────────── Reference data ─────────────
  app.get("/api/reference", async (req) => {
    const a = actorOf(req);
    const scope = projectScope(a);
    const projectRows = await db.select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status }).from(projects)
      .where(scope ? (scope.length ? inArray(projects.id, scope) : sql`false`) : undefined).orderBy(asc(projects.code));
    const siteRows = projectRows.length
      ? await db.select().from(sites).where(inArray(sites.projectId, projectRows.map((p) => p.id))).orderBy(asc(sites.code))
      : [];
    return {
      projects: projectRows,
      sites: siteRows,
      locations: await inv.listLocations(db, a),
      costCodes: await db.select().from(costCodes).where(eq(costCodes.isActive, true)).orderBy(asc(costCodes.code)),
      units: await db.select().from(units).orderBy(asc(units.code)),
      vatCodes: Object.entries(VAT_CODES).map(([code, v]) => ({ code, ...v })),
      vatVerified: VAT_VERIFIED,
      // Subcontractors and consultants, for site manpower and submittals (names only).
      partners: await db.select({ id: companies.id, name: companies.name, isSubcontractor: companies.isSubcontractor, isConsultant: companies.isConsultant })
        .from(companies).where(and(eq(companies.isActive, true), sql`(${companies.isSubcontractor} or ${companies.isConsultant})`)).orderBy(asc(companies.name)),
    };
  });

  app.get("/api/items", async (req) => {
    const a = actorOf(req);
    requirePerm(a, "masters.view");
    const q = z.object({ search: z.string().max(100).optional() }).parse(req.query);
    const rows = await db.select().from(items)
      .where(and(eq(items.isActive, true), q.search ? sql`(${items.code} ilike ${"%" + q.search + "%"} or ${items.description} ilike ${"%" + q.search + "%"})` : undefined))
      .orderBy(asc(items.code)).limit(500);
    const conv = rows.length ? await db.select().from(itemUnitConversions).where(inArray(itemUnitConversions.itemId, rows.map((r) => r.id))) : [];
    return rows.map((r) => ({ ...r, conversions: conv.filter((c) => c.itemId === r.id) }));
  });

  app.post("/api/items", async (req) => {
    const a = actorOf(req);
    requirePerm(a, "masters.manage");
    const b = z.object({
      code: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(300), category: z.string().trim().min(1).max(80),
      specification: optText, brand: optText, baseUnit: z.string(), purchaseUnit: z.string().nullish(), reorderLevel: decimalStr.nullish(),
      conversions: z.array(z.object({ unitCode: z.string(), baseUnitsPerUnit: decimalStr })).default([]),
    }).parse(req.body);
    return db.transaction(async (tx) => {
      const [item] = await tx.insert(items).values({
        code: b.code.toUpperCase(), description: b.description, category: b.category, specification: b.specification ?? null, brand: b.brand ?? null,
        baseUnit: b.baseUnit, purchaseUnit: b.purchaseUnit ?? null, reorderLevel: b.reorderLevel ?? null,
      }).returning();
      if (b.conversions.length) await tx.insert(itemUnitConversions).values(b.conversions.map((c) => ({ itemId: item.id, unitCode: c.unitCode, baseUnitsPerUnit: c.baseUnitsPerUnit })));
      await audit(tx, a, "item.created", "item", item.id, null, { code: item.code });
      return item;
    });
  });

  app.get("/api/suppliers", async (req) => {
    requirePerm(actorOf(req), "masters.view");
    return db.select({ id: companies.id, code: companies.code, name: companies.name, trn: companies.trn, paymentTerms: companies.paymentTerms, phone: companies.phone, email: companies.email })
      .from(companies).where(and(eq(companies.isSupplier, true), eq(companies.isActive, true))).orderBy(asc(companies.name));
  });

  app.post("/api/suppliers", async (req) => {
    const a = actorOf(req);
    requirePerm(a, "masters.manage");
    const b = z.object({
      code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200), legalName: optText, trn: optText, address: optText,
      phone: optText, email: z.string().email().nullish(), paymentTerms: optText,
    }).parse(req.body);
    const [c] = await db.insert(companies).values({ ...b, code: b.code.toUpperCase(), isSupplier: true }).returning();
    await audit(db, a, "supplier.created", "company", c.id, null, { code: c.code });
    return c;
  });

  app.get("/api/projects/:id", async (req) => {
    const a = actorOf(req);
    const { id } = idParam.parse(req.params);
    requireProject(a, id, "Project");
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    if (!p) throw notFound("Project");
    const [client] = p.clientCompanyId ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, p.clientCompanyId)) : [];
    const team = await db.select({ id: users.id, fullName: users.fullName, jobTitle: users.jobTitle }).from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, id)).orderBy(asc(users.fullName));
    return { ...p, contractValue: a.permissions.has("cost.view") ? p.contractValue : null, clientName: client?.name ?? null, team,
      sites: await db.select().from(sites).where(eq(sites.projectId, id)) };
  });

  // ───────────── Material requests ─────────────
  app.get("/api/material-requests", async (req) => {
    const q = page.extend({ projectId: uuid.optional(), status: z.string().optional() }).parse(req.query);
    return mr.listMrs(db, actorOf(req), q);
  });
  app.post("/api/material-requests", async (req) => mr.createMr(db, actorOf(req), mrBody.parse(req.body)));
  app.get("/api/material-requests/:id", async (req) => mr.getMr(db, actorOf(req), idParam.parse(req.params).id));
  app.put("/api/material-requests/:id", async (req) => {
    const b = mrBody.omit({ projectId: true }).extend({ version: z.number().int() }).parse(req.body);
    return mr.updateMr(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/material-requests/:id/submit", async (req) => {
    const b = z.object({ version: z.number().int().optional() }).parse(req.body ?? {});
    return mr.submitMr(db, actorOf(req), idParam.parse(req.params).id, b.version);
  });
  app.post("/api/material-requests/:id/revise", async (req) => mr.reviseMr(db, actorOf(req), idParam.parse(req.params).id));
  app.post("/api/material-requests/:id/cancel", async (req) => {
    const b = z.object({ reason: z.string().trim().min(1) }).parse(req.body);
    return mr.cancelMr(db, actorOf(req), idParam.parse(req.params).id, b.reason);
  });
  app.post("/api/material-request-lines/:id/reserve", async (req) => {
    const b = z.object({ locationId: uuid, qty: decimalStr }).parse(req.body);
    return mr.reserveForLine(db, actorOf(req), idParam.parse(req.params).id, b.locationId, b.qty);
  });
  app.post("/api/reservations/:id/release", async (req) => {
    await mr.releaseReservation(db, actorOf(req), idParam.parse(req.params).id);
    return { ok: true };
  });

  // ───────────── Approvals ─────────────
  app.get("/api/approvals/mine", async (req) => myPendingApprovals(db, actorOf(req)));
  app.post("/api/approvals/:id/decide", async (req) => {
    const b = z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(2000).optional() }).parse(req.body);
    return db.transaction((tx) => decide(tx, actorOf(req), idParam.parse(req.params).id, b.decision, b.comment));
  });

  // ───────────── Purchase orders & receipts ─────────────
  app.get("/api/purchase-orders", async (req) => {
    const q = page.extend({ projectId: uuid.optional(), status: z.string().optional() }).parse(req.query);
    return po.listPos(db, actorOf(req), q);
  });
  app.post("/api/purchase-orders", async (req) => po.createPo(db, actorOf(req), poBody.parse(req.body)));
  app.get("/api/purchase-orders/:id", async (req) => po.getPo(db, actorOf(req), idParam.parse(req.params).id));
  app.put("/api/purchase-orders/:id", async (req) => {
    const b = poBody.omit({ projectId: true }).extend({ version: z.number().int() }).parse(req.body);
    return po.updatePo(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/purchase-orders/:id/submit", async (req) => {
    const b = z.object({ version: z.number().int().optional() }).parse(req.body ?? {});
    return po.submitPo(db, actorOf(req), idParam.parse(req.params).id, b.version);
  });
  app.post("/api/purchase-orders/:id/revise", async (req) => {
    const b = z.object({ reason: z.string().trim().min(1) }).parse(req.body);
    return po.revisePo(db, actorOf(req), idParam.parse(req.params).id, b.reason);
  });
  app.post("/api/purchase-orders/:id/short-close", async (req) => {
    const b = z.object({ reason: z.string().trim().min(1) }).parse(req.body);
    return po.shortClosePo(db, actorOf(req), idParam.parse(req.params).id, b.reason);
  });
  app.post("/api/purchase-orders/:id/receipts", async (req, reply) => {
    const b = z.object({
      idempotencyKey: idemKey, receivedDate: isoDate.optional(), deliveryNoteRef: optText, notes: optText,
      lines: z.array(z.object({ poLineId: uuid, qtyReceived: decimalStr, qtyRejected: decimalStr.optional(), rejectionReason: optText })).min(1),
    }).parse(req.body);
    const res = await po.receiveGoods(db, actorOf(req), idParam.parse(req.params).id, b);
    return reply.code(res.replayed ? 200 : 201).send(res);
  });
  app.get("/api/goods-receipts/:id", async (req) => po.getReceipt(db, actorOf(req), idParam.parse(req.params).id));

  // ───────────── Stock ─────────────
  app.get("/api/stock", async (req) => {
    const q = z.object({ locationId: uuid.optional(), itemId: uuid.optional(), projectId: uuid.optional() }).parse(req.query);
    return inv.stockPosition(db, actorOf(req), q);
  });
  app.get("/api/stock/card/:id", async (req) => {
    const q = z.object({ locationId: uuid.optional() }).parse(req.query);
    return inv.stockCard(db, actorOf(req), idParam.parse(req.params).id, q.locationId);
  });
  app.get("/api/stock/card/:id/export", async (req, reply) => {
    const a = actorOf(req);
    requirePerm(a, "report.export");
    const q = z.object({ locationId: uuid.optional() }).parse(req.query);
    const card = await inv.stockCard(db, a, idParam.parse(req.params).id, q.locationId);
    await audit(db, a, "export.stock_card", "item", card.item.id, null, { rows: card.rows.length });
    return sendCsv(reply, `stock-card-${card.item.code}.csv`, toCsv(card.rows, [
      { key: "seq", header: "Seq" }, { key: "date", header: "Date" }, { key: "type", header: "Movement" }, { key: "location", header: "Location" },
      { key: "status", header: "Stock status" }, { key: "qtyDelta", header: `Qty (${card.item.baseUnit})` }, { key: "balanceInBucket", header: "Balance" },
      { key: "sourceNumber", header: "Document" }, { key: "project", header: "Project" }, { key: "costCode", header: "Cost code" },
      { key: "unitCost", header: "Unit cost (AED)" }, { key: "valueDelta", header: "Value (AED)" }, { key: "postedBy", header: "Posted by" }, { key: "note", header: "Note" },
    ]));
  });
  app.post("/api/stock-issues", async (req, reply) => {
    const b = z.object({
      idempotencyKey: idemKey, locationId: uuid, issuedTo: z.string().trim().min(1).max(200), issueDate: isoDate.optional(), notes: optText,
      lines: z.array(z.object({ mrLineId: uuid, qty: decimalStr })).min(1),
    }).parse(req.body);
    const res = await inv.issueStock(db, actorOf(req), b);
    return reply.code(res.replayed ? 200 : 201).send(res);
  });
  app.get("/api/stock-issues", async (req) => inv.listIssues(db, actorOf(req), page.extend({ projectId: uuid.optional() }).parse(req.query)));
  app.get("/api/stock-issues/:id", async (req) => inv.getIssue(db, actorOf(req), idParam.parse(req.params).id));
  app.get("/api/transfers", async (req) => inv.listTransfers(db, actorOf(req), page.parse(req.query)));
  app.get("/api/transfers/:id", async (req) => inv.getTransfer(db, actorOf(req), idParam.parse(req.params).id));
  app.post("/api/transfers", async (req, reply) => {
    const b = z.object({
      idempotencyKey: idemKey, fromLocationId: uuid, toLocationId: uuid, dispatchDate: isoDate.optional(), vehicleRef: optText, notes: optText,
      lines: z.array(z.object({ itemId: uuid, qty: decimalStr, mrLineId: uuid.nullish() })).min(1),
    }).parse(req.body);
    const res = await inv.dispatchTransfer(db, actorOf(req), b);
    return reply.code(res.replayed ? 200 : 201).send(res);
  });
  app.post("/api/transfers/:id/receive", async (req) => {
    const b = z.object({
      idempotencyKey: idemKey, receivedDate: isoDate.optional(), lines: z.array(z.object({ lineId: uuid, qtyReceived: decimalStr, note: optText })).min(1),
    }).parse(req.body);
    return inv.receiveTransfer(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/transfer-lines/:id/resolve", async (req) => {
    const b = z.object({ resolution: z.enum(["found", "written_off"]), note: z.string().trim().min(1) }).parse(req.body);
    await inv.resolveDiscrepancy(db, actorOf(req), idParam.parse(req.params).id, b.resolution, b.note);
    return { ok: true };
  });

  // ───────────── Reports & dashboard ─────────────
  app.get("/api/dashboard", async (req) => dashboard(db, actorOf(req)));
  app.get("/api/reports/projects/:id", async (req) => projectReport(db, actorOf(req), idParam.parse(req.params).id));
  app.get("/api/reports/projects/:id/drill", async (req) => {
    const q = z.object({ metric: z.string(), costCodeId: uuid.optional() }).parse(req.query);
    return projectDrill(db, actorOf(req), idParam.parse(req.params).id, q.metric, q.costCodeId);
  });
  app.get("/api/reports/projects/:id/export", async (req, reply) => {
    const a = actorOf(req);
    requirePerm(a, "report.export", "cost.view");
    const { id } = idParam.parse(req.params);
    const q = z.object({ metric: z.enum(["committed", "received", "issued"]) }).parse(req.query);
    const report = await projectReport(db, a, id);
    const rows = await drillRows(db, id, q.metric);
    await audit(db, a, "export.project_report", "project", id, id, { metric: q.metric, rows: rows.length });
    return sendCsv(reply, `${report.project.code}-${q.metric}.csv`, toCsv(rows, [
      { key: "docNumber", header: "Document" }, { key: "lineNo", header: "Line" }, { key: "date", header: "Date" }, { key: "itemCode", header: "Item" },
      { key: "itemDescription", header: "Description" }, { key: "costCode", header: "Cost code" }, { key: "qtyBase", header: "Qty" },
      { key: "baseUnit", header: "Unit" }, { key: "value", header: "Value AED excl. VAT" },
    ]));
  });

  // ───────────── Administration ─────────────
  app.get("/api/admin/users", async (req) => {
    requirePerm(actorOf(req), "admin.users");
    const us = await db.select({ id: users.id, email: users.email, fullName: users.fullName, jobTitle: users.jobTitle, isActive: users.isActive, lastLoginAt: users.lastLoginAt })
      .from(users).orderBy(asc(users.fullName));
    const ur = await db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId));
    const pm = await db.select({ userId: projectMembers.userId, code: projects.code }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId));
    return us.map((u) => ({ ...u, roles: ur.filter((r) => r.userId === u.id).map((r) => r.key), projects: pm.filter((p) => p.userId === u.id).map((p) => p.code) }));
  });

  app.get("/api/audit", async (req) => {
    const a = actorOf(req);
    requirePerm(a, "audit.view");
    const q = page.extend({ entityType: z.string().optional(), entityId: z.string().optional(), since: isoDate.optional() }).parse(req.query);
    const rows = await db.select({ e: auditEvents, userName: users.fullName, projectCode: projects.code }).from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.userId))
      .leftJoin(projects, eq(projects.id, auditEvents.projectId))
      .where(and(
        q.entityType ? eq(auditEvents.entityType, q.entityType) : undefined,
        q.entityId ? eq(auditEvents.entityId, q.entityId) : undefined,
        q.since ? gte(auditEvents.at, new Date(`${q.since}T00:00:00+04:00`)) : undefined,
      ))
      .orderBy(desc(auditEvents.id)).limit(q.limit).offset(q.offset);
    return rows
      .filter((r) => !r.e.projectId || canAccessProject(a, r.e.projectId))
      .map((r) => ({ ...r.e, userName: r.userName, projectCode: r.projectCode }));
  });

  // ───────────── Owner's overview & progress ─────────────
  app.get("/api/overview", async (req) => overview(db, actorOf(req)));
  app.get("/api/projects/:id/progress", async (req) => progressHistory(db, actorOf(req), idParam.parse(req.params).id));
  app.post("/api/projects/:id/progress", async (req) => {
    const b = z.object({
      asOfDate: isoDate, plannedPct: decimalStr, actualPct: decimalStr, forecastEndDate: isoDate.nullish(), summary: optText, risks: optText,
    }).parse(req.body);
    return addProgressUpdate(db, actorOf(req), { ...b, projectId: idParam.parse(req.params).id });
  });

  // ───────────── Submittals, samples & mock-ups ─────────────
  app.get("/api/submittals", async (req) => {
    const q = z.object({ projectId: uuid.optional(), status: z.string().optional(), type: z.string().optional(), ball: z.enum(["consultant", "edge"]).optional(), overdue: z.coerce.boolean().optional() }).parse(req.query);
    return sub.listSubmittals(db, actorOf(req), q);
  });
  app.post("/api/submittals", async (req) => sub.createSubmittal(db, actorOf(req), submittalBody.parse(req.body)));
  app.get("/api/submittals/:id", async (req) => sub.getSubmittal(db, actorOf(req), idParam.parse(req.params).id));
  app.put("/api/submittals/:id", async (req) => {
    const b = submittalBody.omit({ projectId: true }).extend({ version: z.number().int() }).parse(req.body);
    return sub.updateSubmittal(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/submittals/:id/submit", async (req) => {
    const b = z.object({ submittedDate: isoDate, transmittalRef: optText, notes: optText, version: z.number().int().optional() }).parse(req.body);
    return sub.submitToConsultant(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/submittals/:id/response", async (req) => {
    const b = z.object({ codeId: uuid, returnedDate: isoDate, consultantComments: optText, reviewerName: optText, inspectionDate: isoDate.nullish(), version: z.number().int().optional() }).parse(req.body);
    return sub.recordResponse(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/submittals/:id/cancel", async (req) => {
    const b = z.object({ reason: z.string().trim().min(1) }).parse(req.body);
    await sub.cancelSubmittal(db, actorOf(req), idParam.parse(req.params).id, b.reason);
    return { ok: true };
  });
  app.get("/api/projects/:id/submittal-codes", async (req) => sub.listCodes(db, actorOf(req), idParam.parse(req.params).id));
  app.put("/api/projects/:id/submittal-codes", async (req) => {
    const b = z.object({ codes: z.array(z.object({ code: z.string().trim().min(1).max(10), label: z.string().trim().min(1).max(100), outcome: z.enum(sub.OUTCOMES) })).min(1).max(20) }).parse(req.body);
    return sub.setCodes(db, actorOf(req), idParam.parse(req.params).id, b.codes);
  });

  // ───────────── Daily site reports ─────────────
  app.get("/api/site-reports", async (req) => {
    const q = z.object({ projectId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
    return sr.listSiteReports(db, actorOf(req), q);
  });
  app.post("/api/site-reports", async (req) => sr.createSiteReport(db, actorOf(req), siteReportBody.parse(req.body)));
  app.get("/api/site-reports/:id", async (req) => sr.getSiteReport(db, actorOf(req), idParam.parse(req.params).id));
  app.put("/api/site-reports/:id", async (req) => {
    const b = siteReportBody.omit({ projectId: true, reportDate: true }).extend({ version: z.number().int() }).parse(req.body);
    return sr.updateSiteReport(db, actorOf(req), idParam.parse(req.params).id, b);
  });
  app.post("/api/site-reports/:id/submit", async (req) => {
    const b = z.object({ version: z.number().int().optional() }).parse(req.body ?? {});
    await sr.submitSiteReport(db, actorOf(req), idParam.parse(req.params).id, b.version);
    return { ok: true };
  });
  app.post("/api/site-reports/:id/review", async (req) => {
    const b = z.object({ decision: z.enum(["accept", "return"]), comment: optText }).parse(req.body);
    await sr.reviewSiteReport(db, actorOf(req), idParam.parse(req.params).id, b.decision, b.comment);
    return { ok: true };
  });

  /** Document history visible to anyone who can see the document itself. */
  app.get("/api/history/:type/:id", async (req) => {
    const a = actorOf(req);
    const p = z.object({ type: z.enum(["material_request", "purchase_order", "goods_receipt", "stock_issue", "stock_transfer", "submittal", "site_report"]), id: uuid }).parse(req.params);
    if (p.type === "material_request") await mr.getMr(db, a, p.id);
    else if (p.type === "purchase_order") await po.getPo(db, a, p.id);
    else if (p.type === "goods_receipt") await po.getReceipt(db, a, p.id);
    else if (p.type === "stock_issue") await inv.getIssue(db, a, p.id);
    else if (p.type === "stock_transfer") await inv.getTransfer(db, a, p.id);
    else if (p.type === "submittal") await sub.getSubmittal(db, a, p.id);
    else if (p.type === "site_report") await sr.getSiteReport(db, a, p.id);
    else throw rule("UNKNOWN_TYPE", "Unknown type");
    return db.select({ id: auditEvents.id, at: auditEvents.at, action: auditEvents.action, details: auditEvents.details, userName: users.fullName })
      .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.userId))
      .where(and(eq(auditEvents.entityType, p.type), eq(auditEvents.entityId, p.id))).orderBy(asc(auditEvents.id));
  });

  app.get("/api/locations/:id", async (req) => {
    const a = actorOf(req);
    const { id } = idParam.parse(req.params);
    const visible = await inv.listLocations(db, a);
    const loc = visible.find((l) => l.id === id);
    if (!loc) throw notFound("Location");
    const [full] = await db.select().from(locations).where(eq(locations.id, id));
    return full;
  });
}
