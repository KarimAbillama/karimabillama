/**
 * Stock issues, transfers and stock enquiries.
 *
 * Issues: every issue line must reference an APPROVED material-request line (that is the
 * authorisation). The project and cost code come from that request. The line's own reservation at
 * the issuing location is consumed first; any remainder must come from unreserved stock.
 *
 * Transfers: dispatch moves stock from the source into the system "transit" location; the
 * destination only gains stock when the receiver confirms. Short receipts create a discrepancy
 * that must be resolved (found / written off) by an authorised user.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "../db/client.js";
import {
  costCodes, items, locations, materialRequestLines, materialRequests, projects, reservations, sites,
  stockIssueLines, stockIssues, stockMovements, stockTransferLines, stockTransfers, users,
} from "../db/schema.js";
import { type Actor, can, canAccessProject, projectScope, requireLocation, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { businessToday } from "../lib/dates.js";
import { Decimal, dec, m2, q4 } from "../lib/decimal.js";
import { conflict, notFound, pgConstraint, rule } from "../lib/errors.js";
import { nextDocNumber } from "../lib/numbering.js";
import { lineFulfilment } from "./materialRequests.js";
import {
  consumeReservations, currentAvgCost, lockBalance, lockOwnReservations, postMovement, reservedQty, transitLocationId, valuationIn, valuationOut,
} from "./stock.js";

// ───────────────────────────── Issues ─────────────────────────────

export interface IssueInput {
  idempotencyKey: string; locationId: string; issuedTo: string; issueDate?: string; notes?: string | null;
  lines: { mrLineId: string; qty: string }[];
}

export async function issueStock(db: DB, actor: Actor, input: IssueInput) {
  requirePerm(actor, "stock.issue");
  if (!input.idempotencyKey) throw rule("IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
  if (!input.issuedTo?.trim()) throw rule("RECIPIENT_REQUIRED", "Enter who received the material.");
  if (!input.lines.length) throw rule("NO_LINES", "Add at least one line.");
  const prior = await findByKey(db, input.idempotencyKey);
  if (prior) {
    requireProject(actor, prior.projectId, "Stock issue");
    return { issue: prior, replayed: true };
  }
  try {
    const issue = await db.transaction(async (tx) => {
      const loc = await requireLocation(tx, actor, input.locationId);
      if (loc.type === "transit") throw rule("INVALID_LOCATION", "Cannot issue from transit.");
      // Resolve MR lines; all must belong to one approved request project.
      const mrLineIds = [...new Set(input.lines.map((l) => l.mrLineId))];
      if (mrLineIds.length !== input.lines.length) throw rule("DUPLICATE_LINE", "Each request line may appear once per issue.");
      const mrLines = await tx
        .select({ line: materialRequestLines, mr: materialRequests })
        .from(materialRequestLines)
        .innerJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
        .where(inArray(materialRequestLines.id, mrLineIds));
      if (mrLines.length !== mrLineIds.length) throw notFound("Material request line");
      const projectIds = new Set(mrLines.map((m) => m.mr.projectId));
      if (projectIds.size !== 1) throw rule("MIXED_PROJECTS", "One issue can only cover a single project.");
      const projectId = mrLines[0].mr.projectId;
      requireProject(actor, projectId, "Material request");
      if (loc.type === "site_store" && loc.projectId !== projectId) throw rule("INVALID_LOCATION", "That site store belongs to another project.");
      for (const m of mrLines) if (m.mr.status !== "approved") throw rule("MR_NOT_APPROVED", `${m.mr.number} is not approved, so it cannot be issued against.`);

      const date = input.issueDate ?? businessToday();
      const number = await nextDocNumber(tx, "ISS");
      const [iss] = await tx.insert(stockIssues).values({
        number, projectId, siteId: mrLines[0].mr.siteId, locationId: loc.id, issuedTo: input.issuedTo.trim(), issueDate: date,
        issuedBy: actor.userId, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey,
      }).returning();

      // Lock balances in a consistent order to avoid deadlocks between concurrent issues.
      const ordered = [...input.lines].sort((a, b) => {
        const ia = mrLines.find((m) => m.line.id === a.mrLineId)!.line.itemId;
        const ib = mrLines.find((m) => m.line.id === b.mrLineId)!.line.itemId;
        return ia.localeCompare(ib);
      });
      for (const li of ordered) {
        const { line, mr } = mrLines.find((m) => m.line.id === li.mrLineId)!;
        const qty = dec(li.qty);
        if (qty.lte(0)) throw rule("INVALID_QTY", "Quantities must be greater than zero.");
        const available = await lockBalance(tx, line.itemId, loc.id, "available");
        const reservedByOthers = await reservedQty(tx, line.itemId, loc.id, line.id);
        const own = (await lockOwnReservations(tx, line.id, loc.id)).reduce((a, r) => a.plus(r.open), new Decimal(0));
        const usable = available.minus(reservedByOthers);
        if (qty.gt(usable)) {
          throw rule("INSUFFICIENT_STOCK", `${mr.number} line ${line.lineNo}: only ${q4(Decimal.max(usable, 0))} can be issued from ${loc.code} (reserved for this request: ${q4(own)}).`);
        }
        const f = (await lineFulfilment(tx, [line.id])).get(line.id)!;
        const remaining = f.requested.minus(f.issued);
        if (qty.gt(remaining)) throw rule("OVER_ISSUE", `${mr.number} line ${line.lineNo}: only ${q4(remaining)} remains to be issued on the request.`);
        // Free (unreserved) stock used beyond this line's own reservation must not be promised elsewhere
        // as part of coverage; consuming reservations first keeps "uncovered" correct.
        await consumeReservations(tx, line.id, loc.id, qty);
        if (f.issued.plus(qty).gte(f.requested)) {
          // Line fully issued: free any stock still held for it elsewhere.
          await tx.update(reservations).set({ status: "released" }).where(and(eq(reservations.mrLineId, line.id), eq(reservations.status, "active")));
        }
        const unitCost = await valuationOut(tx, line.itemId, qty);
        const value = dec(m2(qty.times(unitCost)));
        const [il] = await tx.insert(stockIssueLines).values({
          stockIssueId: iss.id, itemId: line.itemId, mrLineId: line.id, costCodeId: line.costCodeId, qtyBase: q4(qty), unitCost: q4(unitCost), value: m2(value),
        }).returning();
        await postMovement(tx, {
          movementType: "issue", itemId: line.itemId, locationId: loc.id, status: "available", qtyDelta: qty.negated(), unitCost,
          valueDelta: value.negated(), projectId, costCodeId: line.costCodeId, sourceType: "stock_issue", sourceId: iss.id, sourceLineId: il.id,
          sourceNumber: number, movementDate: date, postedBy: actor.userId,
        });
      }
      await audit(tx, actor, "stock.issued", "stock_issue", iss.id, projectId, { number, location: loc.code, lines: input.lines.length });
      return iss;
    });
    return { issue, replayed: false };
  } catch (err) {
    if (pgConstraint(err) === "stock_issues_idem_unique") {
      const winner = await findByKey(db, input.idempotencyKey);
      if (winner) return { issue: winner, replayed: true };
    }
    throw err;
  }
}

async function findByKey(db: DbOrTx, key: string) {
  const [r] = await db.select().from(stockIssues).where(eq(stockIssues.idempotencyKey, key));
  return r ?? null;
}

export async function getIssue(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "stock.view");
  const [row] = await db
    .select({ iss: stockIssues, projectCode: projects.code, locationCode: locations.code, issuedByName: users.fullName, siteName: sites.name })
    .from(stockIssues)
    .innerJoin(projects, eq(projects.id, stockIssues.projectId))
    .innerJoin(locations, eq(locations.id, stockIssues.locationId))
    .innerJoin(users, eq(users.id, stockIssues.issuedBy))
    .leftJoin(sites, eq(sites.id, stockIssues.siteId))
    .where(eq(stockIssues.id, id));
  if (!row) throw notFound("Stock issue");
  requireProject(actor, row.iss.projectId, "Stock issue");
  const lines = await db
    .select({ line: stockIssueLines, itemCode: items.code, itemDescription: items.description, baseUnit: items.baseUnit, costCode: costCodes.code,
      mrNumber: materialRequests.number, mrId: materialRequests.id, mrLineNo: materialRequestLines.lineNo })
    .from(stockIssueLines)
    .innerJoin(items, eq(items.id, stockIssueLines.itemId))
    .innerJoin(costCodes, eq(costCodes.id, stockIssueLines.costCodeId))
    .leftJoin(materialRequestLines, eq(materialRequestLines.id, stockIssueLines.mrLineId))
    .leftJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
    .where(eq(stockIssueLines.stockIssueId, id));
  const showCost = can(actor, "cost.view");
  return {
    ...row.iss, projectCode: row.projectCode, locationCode: row.locationCode, issuedByName: row.issuedByName, siteName: row.siteName,
    lines: lines.map((l) => ({ ...l.line, unitCost: showCost ? l.line.unitCost : null, value: showCost ? l.line.value : null,
      itemCode: l.itemCode, itemDescription: l.itemDescription, baseUnit: l.baseUnit, costCode: l.costCode, mrNumber: l.mrNumber, mrId: l.mrId, mrLineNo: l.mrLineNo })),
  };
}

// ───────────────────────────── Transfers ─────────────────────────────

export interface TransferInput {
  idempotencyKey: string; fromLocationId: string; toLocationId: string; dispatchDate?: string; vehicleRef?: string | null; notes?: string | null;
  lines: { itemId: string; qty: string; mrLineId?: string | null }[];
}

export async function dispatchTransfer(db: DB, actor: Actor, input: TransferInput) {
  requirePerm(actor, "stock.transfer");
  if (!input.idempotencyKey) throw rule("IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
  if (!input.lines.length) throw rule("NO_LINES", "Add at least one line.");
  if (input.fromLocationId === input.toLocationId) throw rule("SAME_LOCATION", "Source and destination must differ.");
  const [prior] = await db.select().from(stockTransfers).where(eq(stockTransfers.idempotencyKey, input.idempotencyKey));
  if (prior) return { transfer: prior, replayed: true };
  try {
    const transfer = await db.transaction(async (tx) => {
      const from = await requireLocation(tx, actor, input.fromLocationId);
      const to = await requireLocation(tx, actor, input.toLocationId);
      if (from.type === "transit" || to.type === "transit") throw rule("INVALID_LOCATION", "Choose real source and destination locations.");
      const transit = await transitLocationId(tx);
      const date = input.dispatchDate ?? businessToday();
      const number = await nextDocNumber(tx, "TRF");
      const [t] = await tx.insert(stockTransfers).values({
        number, fromLocationId: from.id, toLocationId: to.id, status: "in_transit", dispatchDate: date, dispatchedBy: actor.userId,
        vehicleRef: input.vehicleRef ?? null, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey,
      }).returning();
      const ordered = [...input.lines].sort((a, b) => a.itemId.localeCompare(b.itemId));
      for (const li of ordered) {
        const qty = dec(li.qty);
        if (qty.lte(0)) throw rule("INVALID_QTY", "Quantities must be greater than zero.");
        const [item] = await tx.select().from(items).where(eq(items.id, li.itemId));
        if (!item) throw notFound("Item");
        const available = await lockBalance(tx, li.itemId, from.id, "available");
        let own = new Decimal(0);
        let projectId: string | null = null;
        if (li.mrLineId) {
          const [m] = await tx.select({ line: materialRequestLines, mr: materialRequests }).from(materialRequestLines)
            .innerJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
            .where(eq(materialRequestLines.id, li.mrLineId));
          if (!m || m.line.itemId !== li.itemId) throw rule("INVALID_MR_LINE", "The request line does not match this item.");
          requireProject(actor, m.mr.projectId, "Material request");
          if (m.mr.status !== "approved") throw rule("MR_NOT_APPROVED", `${m.mr.number} is not approved.`);
          if (to.type === "site_store" && to.projectId !== m.mr.projectId) throw rule("INVALID_LOCATION", "Destination store belongs to another project.");
          projectId = m.mr.projectId;
          own = (await lockOwnReservations(tx, li.mrLineId, from.id)).reduce((a, r) => a.plus(r.open), new Decimal(0));
        }
        const usable = available.minus(await reservedQty(tx, li.itemId, from.id, li.mrLineId ?? undefined));
        if (qty.gt(usable)) throw rule("INSUFFICIENT_STOCK", `${item.code}: only ${q4(Decimal.max(usable, 0))} can be dispatched from ${from.code}${li.mrLineId ? ` (incl. ${q4(own)} reserved for this request)` : ""}.`);
        if (li.mrLineId) await consumeReservations(tx, li.mrLineId, from.id, Decimal.min(qty, own));
        const avg = await currentAvgCost(tx, li.itemId);
        const [tl] = await tx.insert(stockTransferLines).values({ stockTransferId: t.id, itemId: li.itemId, mrLineId: li.mrLineId ?? null, qtyDispatched: q4(qty) }).returning();
        const common = { itemId: li.itemId, projectId, sourceType: "stock_transfer", sourceId: t.id, sourceLineId: tl.id, sourceNumber: number, movementDate: date, postedBy: actor.userId, unitCost: avg, valueDelta: 0 };
        await postMovement(tx, { ...common, movementType: "transfer_dispatch", locationId: from.id, status: "available", qtyDelta: qty.negated() });
        await postMovement(tx, { ...common, movementType: "transfer_dispatch", locationId: transit, status: "in_transit", qtyDelta: qty });
      }
      await audit(tx, actor, "stock.transfer_dispatched", "stock_transfer", t.id, from.projectId ?? to.projectId, { number, from: from.code, to: to.code });
      return t;
    });
    return { transfer, replayed: false };
  } catch (err) {
    if (pgConstraint(err) === "stock_transfers_idem_unique") {
      const [winner] = await db.select().from(stockTransfers).where(eq(stockTransfers.idempotencyKey, input.idempotencyKey));
      if (winner) return { transfer: winner, replayed: true };
    }
    throw err;
  }
}

export interface TransferReceiptInput {
  idempotencyKey: string; receivedDate?: string; lines: { lineId: string; qtyReceived: string; note?: string | null }[];
}

export async function receiveTransfer(db: DB, actor: Actor, transferId: string, input: TransferReceiptInput) {
  requirePerm(actor, "stock.transfer");
  if (!input.idempotencyKey) throw rule("IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ id: string }>(sql`select id from stock_transfers where id = ${transferId} for update`);
    if (!lock.rows.length) throw notFound("Transfer");
    const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
    const to = await requireLocation(tx, actor, t.toLocationId);
    if (t.receiveIdempotencyKey === input.idempotencyKey) return { transfer: t, replayed: true };
    if (t.status !== "in_transit") throw conflict(`Transfer ${t.number} has already been received.`);
    const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.stockTransferId, transferId));
    if (input.lines.length !== lines.length || !lines.every((l) => input.lines.some((i) => i.lineId === l.id))) {
      throw rule("ALL_LINES_REQUIRED", "Confirm the received quantity for every line (enter 0 if nothing arrived).");
    }
    const transit = await transitLocationId(tx);
    const date = input.receivedDate ?? businessToday();
    let anyDiscrepancy = false;
    for (const l of lines) {
      const li = input.lines.find((i) => i.lineId === l.id)!;
      const received = dec(li.qtyReceived);
      const dispatched = dec(l.qtyDispatched);
      if (received.lt(0) || received.gt(dispatched)) throw rule("INVALID_QTY", `Received quantity must be between 0 and ${q4(dispatched)}. Over-deliveries need a separate transfer.`);
      const missing = dispatched.minus(received);
      if (missing.gt(0)) {
        anyDiscrepancy = true;
        if (!li.note?.trim()) throw rule("DISCREPANCY_NOTE_REQUIRED", "Explain the shortage (e.g. damaged, not loaded, lost).");
      }
      await tx.update(stockTransferLines).set({
        qtyReceived: q4(received), qtyDiscrepancy: q4(missing), discrepancyStatus: missing.gt(0) ? "open" : "none", discrepancyNote: li.note?.trim() || null,
      }).where(eq(stockTransferLines.id, l.id));
      let projectId: string | null = null;
      if (l.mrLineId) {
        const [m] = await tx.select({ projectId: materialRequests.projectId }).from(materialRequestLines)
          .innerJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId)).where(eq(materialRequestLines.id, l.mrLineId));
        projectId = m.projectId;
      }
      const avg = await currentAvgCost(tx, l.itemId);
      const common = { itemId: l.itemId, projectId, sourceType: "stock_transfer", sourceId: t.id, sourceLineId: l.id, sourceNumber: t.number, movementDate: date, postedBy: actor.userId, unitCost: avg, valueDelta: 0 };
      await postMovement(tx, { ...common, movementType: "transfer_receipt", locationId: transit, status: "in_transit", qtyDelta: dispatched.negated() });
      if (received.gt(0)) {
        await postMovement(tx, { ...common, movementType: "transfer_receipt", locationId: to.id, status: "available", qtyDelta: received });
        if (l.mrLineId) {
          await tx.insert(reservations).values({ itemId: l.itemId, locationId: to.id, mrLineId: l.mrLineId, qty: q4(received), status: "active", source: "receipt", createdBy: actor.userId });
        }
      }
      if (missing.gt(0)) {
        await postMovement(tx, { ...common, movementType: "transfer_discrepancy", locationId: transit, status: "discrepancy", qtyDelta: missing, note: li.note });
      }
    }
    const [updated] = await tx.update(stockTransfers).set({
      status: anyDiscrepancy ? "received_with_discrepancy" : "received", receivedDate: date, receivedBy: actor.userId, receiveIdempotencyKey: input.idempotencyKey,
    }).where(eq(stockTransfers.id, transferId)).returning();
    await audit(tx, actor, "stock.transfer_received", "stock_transfer", t.id, to.projectId, { number: t.number, discrepancy: anyDiscrepancy });
    return { transfer: updated, replayed: false };
  });
}

/**
 * Resolves a transfer shortage.
 *  - found: the goods turned up; they move into the destination's available stock.
 *  - written_off: the goods are lost; inventory value is reduced (an inventory loss, NOT project cost).
 */
export async function resolveDiscrepancy(db: DB, actor: Actor, lineId: string, resolution: "found" | "written_off", note: string) {
  requirePerm(actor, "stock.adjust");
  if (!note?.trim()) throw rule("NOTE_REQUIRED", "Explain the resolution.");
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ id: string }>(sql`select id from stock_transfer_lines where id = ${lineId} for update`);
    if (!lock.rows.length) throw notFound("Transfer line");
    const [l] = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.id, lineId));
    const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, l.stockTransferId));
    const to = await requireLocation(tx, actor, t.toLocationId);
    if (l.discrepancyStatus !== "open") throw conflict("This discrepancy is not open.");
    const qty = dec(l.qtyDiscrepancy);
    const transit = await transitLocationId(tx);
    const date = businessToday();
    const common = { itemId: l.itemId, sourceType: "stock_transfer", sourceId: t.id, sourceLineId: l.id, sourceNumber: t.number, movementDate: date, postedBy: actor.userId, note };
    if (resolution === "found") {
      const avg = await currentAvgCost(tx, l.itemId);
      await postMovement(tx, { ...common, movementType: "discrepancy_found", locationId: transit, status: "discrepancy", qtyDelta: qty.negated(), unitCost: avg, valueDelta: 0 });
      await postMovement(tx, { ...common, movementType: "discrepancy_found", locationId: to.id, status: "available", qtyDelta: qty, unitCost: avg, valueDelta: 0 });
    } else {
      const unitCost = await valuationOut(tx, l.itemId, qty);
      await postMovement(tx, { ...common, movementType: "discrepancy_writeoff", locationId: transit, status: "discrepancy", qtyDelta: qty.negated(), unitCost, valueDelta: dec(m2(qty.times(unitCost))).negated() });
    }
    await tx.update(stockTransferLines).set({ discrepancyStatus: resolution, discrepancyResolvedBy: actor.userId, discrepancyResolvedAt: new Date() }).where(eq(stockTransferLines.id, lineId));
    await audit(tx, actor, `stock.discrepancy_${resolution}`, "stock_transfer", t.id, to.projectId, { number: t.number, qty: q4(qty), note: note.trim() });
  });
}

async function visibleLocationIds(db: DbOrTx, actor: Actor): Promise<string[]> {
  const all = await db.select().from(locations).where(eq(locations.isActive, true));
  return all.filter((l) => (l.projectId ? canAccessProject(actor, l.projectId) : can(actor, "stock.view"))).map((l) => l.id);
}

export async function listTransfers(db: DbOrTx, actor: Actor, opts: { limit: number; offset: number }) {
  requirePerm(actor, "stock.view");
  const visible = await visibleLocationIds(db, actor);
  if (!visible.length) return [];
  const rows = await db.execute<Record<string, unknown>>(sql`
    select t.id, t.number, t.status, t.dispatch_date as "dispatchDate", t.received_date as "receivedDate",
      f.code as "fromCode", f.name as "fromName", d.code as "toCode", d.name as "toName", u.full_name as "dispatchedByName",
      (select count(*)::int from stock_transfer_lines l where l.stock_transfer_id = t.id and l.discrepancy_status = 'open') as "openDiscrepancies"
    from stock_transfers t join locations f on f.id = t.from_location_id join locations d on d.id = t.to_location_id
    join users u on u.id = t.dispatched_by
    where t.from_location_id in (${sql.join(visible.map((v) => sql`${v}::uuid`), sql`, `)})
       or t.to_location_id in (${sql.join(visible.map((v) => sql`${v}::uuid`), sql`, `)})
    order by t.created_at desc limit ${opts.limit} offset ${opts.offset}`);
  return rows.rows;
}

export async function getTransfer(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "stock.view");
  const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
  if (!t) throw notFound("Transfer");
  const visible = await visibleLocationIds(db, actor);
  if (!visible.includes(t.fromLocationId) && !visible.includes(t.toLocationId)) throw notFound("Transfer");
  const [from] = await db.select().from(locations).where(eq(locations.id, t.fromLocationId));
  const [to] = await db.select().from(locations).where(eq(locations.id, t.toLocationId));
  const lines = await db
    .select({ line: stockTransferLines, itemCode: items.code, itemDescription: items.description, baseUnit: items.baseUnit, mrNumber: materialRequests.number })
    .from(stockTransferLines)
    .innerJoin(items, eq(items.id, stockTransferLines.itemId))
    .leftJoin(materialRequestLines, eq(materialRequestLines.id, stockTransferLines.mrLineId))
    .leftJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
    .where(eq(stockTransferLines.stockTransferId, id));
  return {
    ...t, fromCode: from.code, fromName: from.name, toCode: to.code, toName: to.name,
    canReceive: visible.includes(t.toLocationId) && can(actor, "stock.transfer"),
    lines: lines.map((l) => ({ ...l.line, itemCode: l.itemCode, itemDescription: l.itemDescription, baseUnit: l.baseUnit, mrNumber: l.mrNumber })),
  };
}

// ───────────────────────────── Enquiries ─────────────────────────────

export async function listLocations(db: DbOrTx, actor: Actor) {
  const all = await db
    .select({ id: locations.id, code: locations.code, name: locations.name, type: locations.type, projectId: locations.projectId, projectCode: projects.code })
    .from(locations)
    .leftJoin(projects, eq(projects.id, locations.projectId))
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.code));
  return all.filter((l) => (l.projectId ? canAccessProject(actor, l.projectId) : can(actor, "stock.view")));
}

/** Stock position per item and location: physical buckets, reserved and free-to-use. */
export async function stockPosition(db: DbOrTx, actor: Actor, filter: { locationId?: string; itemId?: string; projectId?: string }) {
  if (!can(actor, "stock.view") && !can(actor, "mr.view")) throw notFound("Stock");
  if (filter.projectId) requireProject(actor, filter.projectId, "Project");
  let visible = await visibleLocationIds(db, actor);
  if (filter.locationId) visible = visible.filter((v) => v === filter.locationId);
  if (filter.projectId) {
    const projLocs = await db.select({ id: locations.id }).from(locations).where(eq(locations.projectId, filter.projectId));
    visible = visible.filter((v) => projLocs.some((p) => p.id === v));
  }
  if (!visible.length) return [];
  const showCost = can(actor, "cost.view");
  const rows = await db.execute<{
    item_id: string; item_code: string; description: string; base_unit: string; reorder_level: string | null; location_id: string; location_code: string;
    location_type: string; available: string; quarantine: string; rejected: string; in_transit: string; discrepancy: string; reserved: string; avg_cost: string | null;
  }>(sql`
    select i.id as item_id, i.code as item_code, i.description, i.base_unit, i.reorder_level, l.id as location_id, l.code as location_code, l.type as location_type,
      coalesce(sum(b.qty) filter (where b.status = 'available'), 0) as available,
      coalesce(sum(b.qty) filter (where b.status = 'quarantine'), 0) as quarantine,
      coalesce(sum(b.qty) filter (where b.status = 'rejected'), 0) as rejected,
      coalesce(sum(b.qty) filter (where b.status = 'in_transit'), 0) as in_transit,
      coalesce(sum(b.qty) filter (where b.status = 'discrepancy'), 0) as discrepancy,
      coalesce((select sum(r.qty - r.qty_consumed) from reservations r where r.item_id = i.id and r.location_id = l.id and r.status = 'active'), 0) as reserved,
      v.avg_unit_cost as avg_cost
    from stock_balances b
    join items i on i.id = b.item_id
    join locations l on l.id = b.location_id
    left join item_valuations v on v.item_id = i.id
    where b.location_id in (${sql.join(visible.map((v) => sql`${v}::uuid`), sql`, `)})
      ${filter.itemId ? sql`and i.id = ${filter.itemId}` : sql``}
    group by i.id, l.id, v.avg_unit_cost
    having sum(b.qty) <> 0 or (select count(*) from reservations r where r.item_id = i.id and r.location_id = l.id and r.status = 'active') > 0
    order by l.code, i.code`);
  return rows.rows.map((r) => {
    const free = dec(r.available).minus(r.reserved);
    return {
      itemId: r.item_id, itemCode: r.item_code, description: r.description, baseUnit: r.base_unit, locationId: r.location_id, locationCode: r.location_code,
      locationType: r.location_type, available: q4(r.available), reserved: q4(r.reserved), free: q4(free), quarantine: q4(r.quarantine), rejected: q4(r.rejected),
      inTransit: q4(r.in_transit), discrepancy: q4(r.discrepancy), reorderLevel: r.reorder_level,
      belowReorder: r.reorder_level !== null && r.location_type === "warehouse" && dec(r.available).lte(r.reorder_level),
      avgUnitCost: showCost ? r.avg_cost : null,
      availableValue: showCost && r.avg_cost ? m2(dec(r.available).times(r.avg_cost)) : null,
    };
  });
}

/** Stock card: ledger rows for an item (optionally one location), oldest first with running balance. */
export async function stockCard(db: DbOrTx, actor: Actor, itemId: string, locationId?: string) {
  requirePerm(actor, "stock.view");
  let visible = await visibleLocationIds(db, actor);
  if (locationId) visible = visible.filter((v) => v === locationId);
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) throw notFound("Item");
  if (!visible.length) return { item, rows: [] };
  const showCost = can(actor, "cost.view");
  const rows = await db
    .select({ m: stockMovements, locationCode: locations.code, projectCode: projects.code, costCode: costCodes.code, postedByName: users.fullName })
    .from(stockMovements)
    .innerJoin(locations, eq(locations.id, stockMovements.locationId))
    .innerJoin(users, eq(users.id, stockMovements.postedBy))
    .leftJoin(projects, eq(projects.id, stockMovements.projectId))
    .leftJoin(costCodes, eq(costCodes.id, stockMovements.costCodeId))
    .where(and(eq(stockMovements.itemId, itemId), inArray(stockMovements.locationId, visible)))
    .orderBy(asc(stockMovements.seq))
    .limit(5000);
  const running = new Map<string, Decimal>();
  return {
    item,
    rows: rows.map((r) => {
      const key = `${r.m.locationId}:${r.m.status}`;
      const bal = (running.get(key) ?? new Decimal(0)).plus(r.m.qtyDelta);
      running.set(key, bal);
      return {
        seq: r.m.seq, date: r.m.movementDate, postedAt: r.m.postedAt, type: r.m.movementType, location: r.locationCode, status: r.m.status,
        qtyDelta: r.m.qtyDelta, balanceInBucket: q4(bal), sourceType: r.m.sourceType, sourceId: r.m.sourceId, sourceNumber: r.m.sourceNumber,
        project: r.projectCode, costCode: r.costCode, postedBy: r.postedByName, note: r.m.note,
        unitCost: showCost ? r.m.unitCost : null, valueDelta: showCost ? r.m.valueDelta : null,
      };
    }),
  };
}

export async function listIssues(db: DbOrTx, actor: Actor, filter: { projectId?: string; limit: number; offset: number }) {
  requirePerm(actor, "stock.view");
  const scope = projectScope(actor);
  if (filter.projectId) requireProject(actor, filter.projectId, "Project");
  return db
    .select({ id: stockIssues.id, number: stockIssues.number, issueDate: stockIssues.issueDate, issuedTo: stockIssues.issuedTo, projectCode: projects.code,
      locationCode: locations.code, issuedByName: users.fullName })
    .from(stockIssues)
    .innerJoin(projects, eq(projects.id, stockIssues.projectId))
    .innerJoin(locations, eq(locations.id, stockIssues.locationId))
    .innerJoin(users, eq(users.id, stockIssues.issuedBy))
    .where(and(
      filter.projectId ? eq(stockIssues.projectId, filter.projectId) : undefined,
      scope ? (scope.length ? inArray(stockIssues.projectId, scope) : sql`false`) : undefined,
    ))
    .orderBy(desc(stockIssues.postedAt))
    .limit(filter.limit)
    .offset(filter.offset);
}

/** Opening balance (used by seed/import): stock + valuation in one posting. */
export async function postOpeningBalance(db: DB, actor: Actor, args: { itemId: string; locationId: string; qty: string; unitCost: string; reference: string; date: string }) {
  requirePerm(actor, "stock.adjust");
  return db.transaction(async (tx) => {
    const qty = dec(args.qty);
    const unitCost = dec(args.unitCost);
    const sourceId = (await tx.execute<{ id: string }>(sql`select gen_random_uuid() as id`)).rows[0].id;
    await postMovement(tx, {
      movementType: "opening", itemId: args.itemId, locationId: args.locationId, status: "available", qtyDelta: qty, unitCost,
      sourceType: "opening_balance", sourceId, sourceNumber: args.reference, movementDate: args.date, postedBy: actor.userId, note: "Opening balance",
    });
    await valuationIn(tx, args.itemId, qty, unitCost);
    await audit(tx, actor, "stock.opening_balance", "item", args.itemId, null, { qty: q4(qty), reference: args.reference });
  });
}

