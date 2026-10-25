/**
 * Site material requests: draft → pending_approval → approved (or rejected → revise → draft).
 * After approval the line is covered by: stock reservations, purchase orders, transfers in transit
 * and issues. `uncovered` is what still needs action.
 *
 *   uncovered = requested − issued − open reservations − open PO quantity − in transit
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx, Tx } from "../db/client.js";
import { costCodes, items, materialRequestLines, materialRequests, projects, reservations, sites, users } from "../db/schema.js";
import { type Actor, projectScope, requireLocation, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { Decimal, dec, q4 } from "../lib/decimal.js";
import { conflict, notFound, rule } from "../lib/errors.js";
import { nextDocNumber } from "../lib/numbering.js";
import { approvalHistory, startApproval, supersedeApprovals } from "./approvals.js";
import { lockBalance, reservedQty } from "./stock.js";

export interface MrLineInput { itemId: string; qty: string; costCodeId: string; remarks?: string | null }
export interface MrInput { projectId: string; siteId?: string | null; requiredDate: string; purpose?: string | null; lines: MrLineInput[] }

async function validateLines(tx: DbOrTx, lines: MrLineInput[]) {
  if (!lines.length) throw rule("NO_LINES", "Add at least one item.");
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const found = await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, itemIds), eq(items.isActive, true)));
  if (found.length !== itemIds.length) throw rule("UNKNOWN_ITEM", "One or more items do not exist or are inactive.");
  const ccIds = [...new Set(lines.map((l) => l.costCodeId))];
  const ccs = await tx.select({ id: costCodes.id }).from(costCodes).where(and(inArray(costCodes.id, ccIds), eq(costCodes.isActive, true)));
  if (ccs.length !== ccIds.length) throw rule("UNKNOWN_COST_CODE", "One or more cost codes do not exist or are inactive.");
  for (const l of lines) if (dec(l.qty).lte(0)) throw rule("INVALID_QTY", "Quantities must be greater than zero.");
}

async function validateSite(tx: DbOrTx, projectId: string, siteId?: string | null) {
  if (!siteId) return;
  const [s] = await tx.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.projectId, projectId)));
  if (!s) throw rule("INVALID_SITE", "The site does not belong to this project.");
}

export async function createMr(db: DB, actor: Actor, input: MrInput) {
  requirePerm(actor, "mr.create");
  requireProject(actor, input.projectId, "Project");
  return db.transaction(async (tx) => {
    await validateSite(tx, input.projectId, input.siteId);
    await validateLines(tx, input.lines);
    const number = await nextDocNumber(tx, "MR");
    const [mr] = await tx.insert(materialRequests).values({
      number, projectId: input.projectId, siteId: input.siteId ?? null, requiredDate: input.requiredDate,
      purpose: input.purpose ?? null, status: "draft", requestedBy: actor.userId,
    }).returning();
    await tx.insert(materialRequestLines).values(input.lines.map((l, i) => ({
      materialRequestId: mr.id, lineNo: i + 1, itemId: l.itemId, qty: q4(l.qty), costCodeId: l.costCodeId, remarks: l.remarks ?? null,
    })));
    await audit(tx, actor, "mr.created", "material_request", mr.id, mr.projectId, { number });
    return mr;
  });
}

async function lockMr(tx: Tx, actor: Actor, id: string) {
  const res = await tx.execute<{ id: string }>(sql`select id from material_requests where id = ${id} for update`);
  if (!res.rows.length) throw notFound("Material request");
  const [mr] = await tx.select().from(materialRequests).where(eq(materialRequests.id, id));
  requireProject(actor, mr.projectId, "Material request");
  return mr;
}

function checkVersion(current: number, expected: number | undefined) {
  if (expected !== undefined && expected !== current) {
    throw conflict("Someone else changed this document after you opened it. Reload and try again.");
  }
}

export async function updateMr(db: DB, actor: Actor, id: string, input: Omit<MrInput, "projectId"> & { version: number }) {
  requirePerm(actor, "mr.create");
  return db.transaction(async (tx) => {
    const mr = await lockMr(tx, actor, id);
    checkVersion(mr.version, input.version);
    if (mr.status !== "draft") throw rule("NOT_EDITABLE", "Only draft requests can be edited. Use Revise on a rejected request.");
    await validateSite(tx, mr.projectId, input.siteId);
    await validateLines(tx, input.lines);
    await tx.delete(materialRequestLines).where(eq(materialRequestLines.materialRequestId, id));
    await tx.insert(materialRequestLines).values(input.lines.map((l, i) => ({
      materialRequestId: id, lineNo: i + 1, itemId: l.itemId, qty: q4(l.qty), costCodeId: l.costCodeId, remarks: l.remarks ?? null,
    })));
    const [updated] = await tx.update(materialRequests).set({
      siteId: input.siteId ?? null, requiredDate: input.requiredDate, purpose: input.purpose ?? null,
      version: mr.version + 1, updatedAt: new Date(),
    }).where(eq(materialRequests.id, id)).returning();
    await audit(tx, actor, "mr.updated", "material_request", id, mr.projectId, { number: mr.number });
    return updated;
  });
}

export async function submitMr(db: DB, actor: Actor, id: string, version?: number) {
  requirePerm(actor, "mr.create");
  return db.transaction(async (tx) => {
    const mr = await lockMr(tx, actor, id);
    checkVersion(mr.version, version);
    if (mr.status !== "draft") throw rule("INVALID_STATE", `Cannot submit a request that is ${mr.status}.`);
    const [updated] = await tx.update(materialRequests)
      .set({ status: "pending_approval", submittedAt: new Date(), version: mr.version + 1, updatedAt: new Date() })
      .where(eq(materialRequests.id, id)).returning();
    await startApproval(tx, actor, "material_request", { id, number: mr.number, revision: mr.revision, projectId: mr.projectId, amount: null });
    return updated;
  });
}

/** Rejected (or withdrawn pending) requests go back to draft as a new revision. */
export async function reviseMr(db: DB, actor: Actor, id: string) {
  requirePerm(actor, "mr.create");
  return db.transaction(async (tx) => {
    const mr = await lockMr(tx, actor, id);
    if (!["rejected", "pending_approval"].includes(mr.status)) throw rule("INVALID_STATE", `A ${mr.status} request cannot be revised.`);
    await supersedeApprovals(tx, "material_request", id);
    const [updated] = await tx.update(materialRequests)
      .set({ status: "draft", revision: mr.revision + 1, version: mr.version + 1, updatedAt: new Date(), approvedAt: null })
      .where(eq(materialRequests.id, id)).returning();
    await audit(tx, actor, "mr.revised", "material_request", id, mr.projectId, { number: mr.number, revision: mr.revision + 1 });
    return updated;
  });
}

export async function cancelMr(db: DB, actor: Actor, id: string, reason: string) {
  requirePerm(actor, "mr.create");
  if (!reason?.trim()) throw rule("REASON_REQUIRED", "A cancellation reason is required.");
  return db.transaction(async (tx) => {
    const mr = await lockMr(tx, actor, id);
    if (["cancelled", "closed"].includes(mr.status)) throw rule("INVALID_STATE", `Request is already ${mr.status}.`);
    const lines = await tx.select({ id: materialRequestLines.id }).from(materialRequestLines).where(eq(materialRequestLines.materialRequestId, id));
    const f = await lineFulfilment(tx, lines.map((l) => l.id));
    if ([...f.values()].some((x) => x.issued.gt(0) || x.onOrder.gt(0) || x.inTransit.gt(0))) {
      throw rule("HAS_ACTIVITY", "This request already has issues, purchase orders or transfers. Close those first.");
    }
    if (lines.length) {
      await tx.update(reservations).set({ status: "released" })
        .where(and(inArray(reservations.mrLineId, lines.map((l) => l.id)), eq(reservations.status, "active")));
    }
    await supersedeApprovals(tx, "material_request", id);
    const [updated] = await tx.update(materialRequests)
      .set({ status: "cancelled", version: mr.version + 1, updatedAt: new Date() })
      .where(eq(materialRequests.id, id)).returning();
    await audit(tx, actor, "mr.cancelled", "material_request", id, mr.projectId, { number: mr.number, reason: reason.trim() });
    return updated;
  });
}

export interface LineFulfilment { requested: Decimal; issued: Decimal; reserved: Decimal; onOrder: Decimal; inTransit: Decimal; uncovered: Decimal }

/** Computes coverage for MR lines from the source records (nothing is cached, so it cannot drift). */
export async function lineFulfilment(db: DbOrTx, lineIds: string[]): Promise<Map<string, LineFulfilment>> {
  const out = new Map<string, LineFulfilment>();
  if (!lineIds.length) return out;
  const ids = sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `);
  const res = await db.execute<{ id: string; requested: string; issued: string; reserved: string; on_order: string; in_transit: string }>(sql`
    select l.id, l.qty as requested,
      coalesce((select sum(il.qty_base) from stock_issue_lines il where il.mr_line_id = l.id), 0) as issued,
      coalesce((select sum(r.qty - r.qty_consumed) from reservations r where r.mr_line_id = l.id and r.status = 'active'), 0) as reserved,
      coalesce((select sum(pl.qty_base - pl.qty_cancelled_base
                  - coalesce((select sum(gl.qty_accepted_base) from goods_receipt_lines gl where gl.po_line_id = pl.id), 0))
                from purchase_order_lines pl join purchase_orders po on po.id = pl.purchase_order_id
                where pl.mr_line_id = l.id and po.status not in ('cancelled','rejected','closed')), 0) as on_order,
      coalesce((select sum(tl.qty_dispatched) from stock_transfer_lines tl join stock_transfers t on t.id = tl.stock_transfer_id
                where tl.mr_line_id = l.id and t.status = 'in_transit'), 0) as in_transit
    from material_request_lines l where l.id in (${ids})`);
  for (const r of res.rows) {
    const requested = dec(r.requested), issued = dec(r.issued), reserved = dec(r.reserved), onOrder = dec(r.on_order), inTransit = dec(r.in_transit);
    out.set(r.id, {
      requested, issued, reserved, onOrder, inTransit,
      uncovered: Decimal.max(0, requested.minus(issued).minus(reserved).minus(onOrder).minus(inTransit)),
    });
  }
  return out;
}

const fmtF = (f: LineFulfilment | undefined) => f && ({
  requested: q4(f.requested), issued: q4(f.issued), reserved: q4(f.reserved), onOrder: q4(f.onOrder), inTransit: q4(f.inTransit), uncovered: q4(f.uncovered),
});

export async function getMr(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "mr.view");
  const [row] = await db
    .select({ mr: materialRequests, projectCode: projects.code, projectName: projects.name, siteName: sites.name, requesterName: users.fullName })
    .from(materialRequests)
    .innerJoin(projects, eq(projects.id, materialRequests.projectId))
    .innerJoin(users, eq(users.id, materialRequests.requestedBy))
    .leftJoin(sites, eq(sites.id, materialRequests.siteId))
    .where(eq(materialRequests.id, id));
  if (!row) throw notFound("Material request");
  requireProject(actor, row.mr.projectId, "Material request");
  const lines = await db
    .select({
      line: materialRequestLines, itemCode: items.code, itemDescription: items.description, baseUnit: items.baseUnit,
      costCode: costCodes.code, costCodeName: costCodes.name,
    })
    .from(materialRequestLines)
    .innerJoin(items, eq(items.id, materialRequestLines.itemId))
    .innerJoin(costCodes, eq(costCodes.id, materialRequestLines.costCodeId))
    .where(eq(materialRequestLines.materialRequestId, id))
    .orderBy(asc(materialRequestLines.lineNo));
  const f = await lineFulfilment(db, lines.map((l) => l.line.id));
  const resv = lines.length
    ? await db.execute<{ id: string; mr_line_id: string; location_code: string; location_name: string; qty: string; qty_consumed: string; status: string; source: string }>(sql`
        select r.id, r.mr_line_id, l.code as location_code, l.name as location_name, r.qty, r.qty_consumed, r.status, r.source
        from reservations r join locations l on l.id = r.location_id
        where r.mr_line_id in (${sql.join(lines.map((x) => sql`${x.line.id}::uuid`), sql`, `)}) order by r.created_at`)
    : { rows: [] };
  return {
    ...row.mr,
    projectCode: row.projectCode, projectName: row.projectName, siteName: row.siteName, requesterName: row.requesterName,
    lines: lines.map((l) => ({
      ...l.line, itemCode: l.itemCode, itemDescription: l.itemDescription, baseUnit: l.baseUnit, costCode: l.costCode, costCodeName: l.costCodeName,
      fulfilment: fmtF(f.get(l.line.id)),
      reservations: resv.rows.filter((r) => r.mr_line_id === l.line.id),
    })),
    approvals: await approvalHistory(db, "material_request", id),
  };
}

export async function listMrs(db: DbOrTx, actor: Actor, filter: { projectId?: string; status?: string; limit: number; offset: number }) {
  requirePerm(actor, "mr.view");
  const scope = projectScope(actor);
  if (filter.projectId) requireProject(actor, filter.projectId, "Project");
  const conds = [
    filter.projectId ? eq(materialRequests.projectId, filter.projectId) : undefined,
    scope ? (scope.length ? inArray(materialRequests.projectId, scope) : sql`false`) : undefined,
    filter.status ? eq(materialRequests.status, filter.status as never) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({
      id: materialRequests.id, number: materialRequests.number, status: materialRequests.status, revision: materialRequests.revision,
      requiredDate: materialRequests.requiredDate, projectId: materialRequests.projectId, projectCode: projects.code,
      requesterName: users.fullName, createdAt: materialRequests.createdAt, purpose: materialRequests.purpose,
      lineCount: sql<number>`(select count(*)::int from material_request_lines l where l.material_request_id = ${materialRequests.id})`,
    })
    .from(materialRequests)
    .innerJoin(projects, eq(projects.id, materialRequests.projectId))
    .innerJoin(users, eq(users.id, materialRequests.requestedBy))
    .where(and(...conds))
    .orderBy(desc(materialRequests.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
  return rows;
}

/** Reserve available stock at a location for an approved MR line. */
export async function reserveForLine(db: DB, actor: Actor, mrLineId: string, locationId: string, qty: string) {
  requirePerm(actor, "mr.allocate");
  const want = dec(qty);
  if (want.lte(0)) throw rule("INVALID_QTY", "Quantity must be greater than zero.");
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(materialRequestLines).where(eq(materialRequestLines.id, mrLineId));
    if (!line) throw notFound("Material request line");
    const mr = await lockMr(tx, actor, line.materialRequestId);
    if (mr.status !== "approved") throw rule("NOT_APPROVED", "Stock can only be reserved for approved requests.");
    const loc = await requireLocation(tx, actor, locationId);
    if (loc.type === "transit") throw rule("INVALID_LOCATION", "Cannot reserve stock that is in transit.");
    if (loc.type === "site_store" && loc.projectId !== mr.projectId) {
      throw rule("INVALID_LOCATION", "Stock in another project's site store cannot be reserved; transfer it first.");
    }
    const available = await lockBalance(tx, line.itemId, locationId, "available");
    const free = available.minus(await reservedQty(tx, line.itemId, locationId));
    const f = (await lineFulfilment(tx, [mrLineId])).get(mrLineId)!;
    if (want.gt(f.uncovered)) throw rule("OVER_ALLOCATION", `Only ${q4(f.uncovered)} is still uncovered on this line.`);
    if (want.gt(free)) throw rule("INSUFFICIENT_STOCK", `Only ${q4(Decimal.max(free, 0))} is free to reserve at ${loc.code}.`);
    const [r] = await tx.insert(reservations).values({
      itemId: line.itemId, locationId, mrLineId, qty: q4(want), status: "active", source: "manual", createdBy: actor.userId,
    }).returning();
    await audit(tx, actor, "stock.reserved", "material_request", mr.id, mr.projectId, { number: mr.number, line: line.lineNo, location: loc.code, qty: q4(want) });
    return r;
  });
}

export async function releaseReservation(db: DB, actor: Actor, reservationId: string) {
  requirePerm(actor, "mr.allocate");
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ id: string }>(sql`select id from reservations where id = ${reservationId} for update`);
    if (!res.rows.length) throw notFound("Reservation");
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId));
    const [line] = await tx.select().from(materialRequestLines).where(eq(materialRequestLines.id, r.mrLineId));
    const [mr] = await tx.select().from(materialRequests).where(eq(materialRequests.id, line.materialRequestId));
    requireProject(actor, mr.projectId, "Reservation");
    if (r.status !== "active") throw rule("INVALID_STATE", "Reservation is not active.");
    await tx.update(reservations).set({ status: "released" }).where(eq(reservations.id, reservationId));
    await audit(tx, actor, "stock.reservation_released", "material_request", mr.id, mr.projectId, { reservationId, open: q4(dec(r.qty).minus(r.qtyConsumed)) });
  });
}
