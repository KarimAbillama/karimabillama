/**
 * Purchase orders and goods receipts.
 *
 * Cost recognition (Phase 1 — see docs/ARCHITECTURE.md "Cost recognition"):
 *  - Commitment: approved PO net value (excl. VAT), less cancelled balances.
 *  - Receipt: accepted goods enter inventory at PO price. This is NOT project cost yet.
 *  - Project material cost: recognised when stock is ISSUED to the project's cost code.
 *  So a PO, its receipt and (later) its invoice/payment never count as separate expenses.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx, Tx } from "../db/client.js";
import {
  companies, costCodes, goodsReceiptLines, goodsReceipts, itemUnitConversions, items, locations, materialRequestLines,
  materialRequests, projects, purchaseOrderLines, purchaseOrders, reservations, units, users,
} from "../db/schema.js";
import { type Actor, can, projectScope, requireLocation, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { businessToday } from "../lib/dates.js";
import { Decimal, dec, m2, q4, sum } from "../lib/decimal.js";
import { conflict, notFound, pgConstraint, rule } from "../lib/errors.js";
import { nextDocNumber } from "../lib/numbering.js";
import { toBaseQty } from "../lib/units.js";
import { VAT_CODES, type VatCode } from "../lib/vat.js";
import { approvalHistory, startApproval, supersedeApprovals } from "./approvals.js";
import { lineFulfilment } from "./materialRequests.js";
import { postMovement, valuationIn } from "./stock.js";

export interface PoLineInput {
  itemId: string; mrLineId?: string | null; costCodeId: string; unitCode: string; qty: string; unitPrice: string; vatCode: VatCode;
}
export interface PoInput {
  projectId: string; supplierId: string; deliveryLocationId: string; requiredDate?: string | null; promisedDate?: string | null;
  paymentTerms?: string | null; supplierQuoteRef?: string | null; notes?: string | null; lines: PoLineInput[];
}

async function unitContext(tx: DbOrTx, itemId: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId));
  if (!item || !item.isActive) throw rule("UNKNOWN_ITEM", "Item does not exist or is inactive.");
  const conversions = await tx.select().from(itemUnitConversions).where(eq(itemUnitConversions.itemId, itemId));
  const allUnits = await tx.select().from(units);
  return { item, ctx: { itemCode: item.code, baseUnit: item.baseUnit, conversions, units: allUnits } };
}

async function buildLines(tx: Tx, actor: Actor, projectId: string, lines: PoLineInput[], excludePoId?: string) {
  if (!lines.length) throw rule("NO_LINES", "Add at least one line.");
  const built = [];
  // quantities requested per MR line within this PO, to stop the same shortage being ordered twice
  const perMrLine = new Map<string, Decimal>();
  for (const [i, l] of lines.entries()) {
    const q = dec(l.qty);
    if (q.lte(0)) throw rule("INVALID_QTY", `Line ${i + 1}: quantity must be greater than zero.`);
    if (dec(l.unitPrice).lt(0)) throw rule("INVALID_PRICE", `Line ${i + 1}: price cannot be negative.`);
    if (!(l.vatCode in VAT_CODES)) throw rule("INVALID_VAT_CODE", `Line ${i + 1}: unknown VAT code.`);
    const { ctx } = await unitContext(tx, l.itemId);
    const qtyBase = toBaseQty(ctx, l.unitCode, q);
    const [cc] = await tx.select().from(costCodes).where(eq(costCodes.id, l.costCodeId));
    if (!cc || !cc.isActive) throw rule("UNKNOWN_COST_CODE", `Line ${i + 1}: unknown cost code.`);
    if (l.mrLineId) {
      const [ml] = await tx
        .select({ line: materialRequestLines, mrStatus: materialRequests.status, mrProject: materialRequests.projectId })
        .from(materialRequestLines)
        .innerJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
        .where(eq(materialRequestLines.id, l.mrLineId));
      if (!ml || ml.mrProject !== projectId) throw rule("INVALID_MR_LINE", `Line ${i + 1}: the material request line belongs to another project.`);
      if (ml.mrStatus !== "approved") throw rule("MR_NOT_APPROVED", `Line ${i + 1}: the material request is not approved.`);
      if (ml.line.itemId !== l.itemId) throw rule("ITEM_MISMATCH", `Line ${i + 1}: item differs from the material request. Substitutions need a revised request.`);
      const f = (await lineFulfilment(tx, [l.mrLineId])).get(l.mrLineId)!;
      // When editing a draft, its own existing lines are already counted as "on order"; add them back.
      let ownExisting = new Decimal(0);
      if (excludePoId) {
        const ex = await tx.select({ q: purchaseOrderLines.qtyBase }).from(purchaseOrderLines)
          .where(and(eq(purchaseOrderLines.purchaseOrderId, excludePoId), eq(purchaseOrderLines.mrLineId, l.mrLineId)));
        ownExisting = sum(ex.map((e) => e.q));
      }
      const already = perMrLine.get(l.mrLineId) ?? new Decimal(0);
      const allowed = f.uncovered.plus(ownExisting).minus(already);
      if (qtyBase.gt(allowed)) {
        throw rule("OVER_ORDER", `Line ${i + 1}: only ${q4(Decimal.max(allowed, 0))} ${ctx.baseUnit} is still uncovered on the material request.`);
      }
      perMrLine.set(l.mrLineId, already.plus(qtyBase));
    }
    const vatRate = VAT_CODES[l.vatCode].rate;
    const net = q.times(l.unitPrice);
    built.push({
      lineNo: i + 1, itemId: l.itemId, mrLineId: l.mrLineId ?? null, costCodeId: l.costCodeId, unitCode: l.unitCode,
      qty: q4(q), qtyBase: q4(qtyBase), unitPrice: q4(l.unitPrice), vatCode: l.vatCode, vatRate,
      lineNet: m2(net), lineVat: m2(dec(m2(net)).times(vatRate).dividedBy(100)),
    });
  }
  const subtotal = sum(built.map((b) => b.lineNet));
  const vat = sum(built.map((b) => b.lineVat));
  return { built, subtotal: m2(subtotal), vat: m2(vat), total: m2(subtotal.plus(vat)) };
}

async function validateHeader(tx: Tx, actor: Actor, input: Pick<PoInput, "projectId" | "supplierId" | "deliveryLocationId">) {
  const [sup] = await tx.select().from(companies).where(eq(companies.id, input.supplierId));
  if (!sup || !sup.isSupplier || !sup.isActive) throw rule("INVALID_SUPPLIER", "Supplier does not exist or is inactive.");
  const loc = await requireLocation(tx, actor, input.deliveryLocationId);
  if (loc.type === "transit") throw rule("INVALID_LOCATION", "Choose a warehouse or this project's site store.");
  if (loc.type === "site_store" && loc.projectId !== input.projectId) throw rule("INVALID_LOCATION", "That site store belongs to another project.");
}

export async function createPo(db: DB, actor: Actor, input: PoInput) {
  requirePerm(actor, "po.create");
  requireProject(actor, input.projectId, "Project");
  return db.transaction(async (tx) => {
    await validateHeader(tx, actor, input);
    const { built, subtotal, vat, total } = await buildLines(tx, actor, input.projectId, input.lines);
    const number = await nextDocNumber(tx, "PO");
    const [po] = await tx.insert(purchaseOrders).values({
      number, projectId: input.projectId, supplierId: input.supplierId, deliveryLocationId: input.deliveryLocationId,
      status: "draft", requiredDate: input.requiredDate ?? null, promisedDate: input.promisedDate ?? null,
      paymentTerms: input.paymentTerms ?? null, supplierQuoteRef: input.supplierQuoteRef ?? null, notes: input.notes ?? null,
      subtotal, vatAmount: vat, total, createdBy: actor.userId,
    }).returning();
    await tx.insert(purchaseOrderLines).values(built.map((b) => ({ ...b, purchaseOrderId: po.id })));
    await audit(tx, actor, "po.created", "purchase_order", po.id, po.projectId, { number, subtotal });
    return po;
  });
}

async function lockPo(tx: Tx, actor: Actor, id: string) {
  const res = await tx.execute<{ id: string }>(sql`select id from purchase_orders where id = ${id} for update`);
  if (!res.rows.length) throw notFound("Purchase order");
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  requireProject(actor, po.projectId, "Purchase order");
  return po;
}

export async function updatePo(db: DB, actor: Actor, id: string, input: Omit<PoInput, "projectId"> & { version: number }) {
  requirePerm(actor, "po.create");
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, id);
    if (po.version !== input.version) throw conflict("Someone else changed this purchase order after you opened it. Reload and try again.");
    if (po.status !== "draft") throw rule("NOT_EDITABLE", "Only draft purchase orders can be edited.");
    await validateHeader(tx, actor, { ...input, projectId: po.projectId });
    const { built, subtotal, vat, total } = await buildLines(tx, actor, po.projectId, input.lines, id);
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
    await tx.insert(purchaseOrderLines).values(built.map((b) => ({ ...b, purchaseOrderId: id })));
    const [updated] = await tx.update(purchaseOrders).set({
      supplierId: input.supplierId, deliveryLocationId: input.deliveryLocationId, requiredDate: input.requiredDate ?? null,
      promisedDate: input.promisedDate ?? null, paymentTerms: input.paymentTerms ?? null, supplierQuoteRef: input.supplierQuoteRef ?? null,
      notes: input.notes ?? null, subtotal, vatAmount: vat, total, version: po.version + 1, updatedAt: new Date(),
    }).where(eq(purchaseOrders.id, id)).returning();
    await audit(tx, actor, "po.updated", "purchase_order", id, po.projectId, { number: po.number, subtotal });
    return updated;
  });
}

export async function submitPo(db: DB, actor: Actor, id: string, version?: number) {
  requirePerm(actor, "po.create");
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, id);
    if (version !== undefined && po.version !== version) throw conflict("This purchase order changed after you opened it. Reload and try again.");
    if (po.status !== "draft") throw rule("INVALID_STATE", `Cannot submit a purchase order that is ${po.status}.`);
    const [updated] = await tx.update(purchaseOrders)
      .set({ status: "pending_approval", submittedAt: new Date(), version: po.version + 1, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id)).returning();
    // Thresholds are evaluated on the value excluding VAT (assumption A-07).
    await startApproval(tx, actor, "purchase_order", { id, number: po.number, revision: po.revision, projectId: po.projectId, amount: po.subtotal });
    return updated;
  });
}

/**
 * Re-opens a rejected, pending, or approved-but-not-yet-received PO as a new revision.
 * Any previous approval is superseded, so the changed PO must be approved again.
 */
export async function revisePo(db: DB, actor: Actor, id: string, reason: string) {
  requirePerm(actor, "po.create");
  if (!reason?.trim()) throw rule("REASON_REQUIRED", "A reason is required to revise a purchase order.");
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, id);
    if (!["rejected", "pending_approval", "approved"].includes(po.status)) throw rule("INVALID_STATE", `A ${po.status} purchase order cannot be revised.`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, id));
    if (n > 0) throw rule("HAS_RECEIPTS", "Goods have been received against this PO; amendments after receipt are planned for Phase 2.");
    await supersedeApprovals(tx, "purchase_order", id);
    const [updated] = await tx.update(purchaseOrders)
      .set({ status: "draft", revision: po.revision + 1, version: po.version + 1, approvedAt: null, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id)).returning();
    await audit(tx, actor, "po.revised", "purchase_order", id, po.projectId, { number: po.number, revision: po.revision + 1, reason: reason.trim() });
    return updated;
  });
}

/** Cancels the undelivered balance of every line and closes (or cancels, if nothing was received) the PO. */
export async function shortClosePo(db: DB, actor: Actor, id: string, reason: string) {
  requirePerm(actor, "po.create");
  if (!reason?.trim()) throw rule("REASON_REQUIRED", "A reason is required.");
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, id);
    if (["closed", "cancelled", "received"].includes(po.status)) throw rule("INVALID_STATE", `Purchase order is already ${po.status}.`);
    const lines = await poLinesWithReceipts(tx, id);
    let anyReceived = false;
    for (const l of lines) {
      if (dec(l.acceptedBase).gt(0)) anyReceived = true;
      const outstanding = dec(l.qtyBase).minus(l.qtyCancelledBase).minus(l.acceptedBase);
      if (outstanding.gt(0)) {
        await tx.update(purchaseOrderLines).set({ qtyCancelledBase: q4(dec(l.qtyCancelledBase).plus(outstanding)) }).where(eq(purchaseOrderLines.id, l.id));
      }
    }
    if (!anyReceived) await supersedeApprovals(tx, "purchase_order", id);
    const status = anyReceived ? "closed" : "cancelled";
    const [updated] = await tx.update(purchaseOrders).set({ status, version: po.version + 1, updatedAt: new Date() }).where(eq(purchaseOrders.id, id)).returning();
    await audit(tx, actor, `po.${status}`, "purchase_order", id, po.projectId, { number: po.number, reason: reason.trim() });
    return updated;
  });
}

async function poLinesWithReceipts(db: DbOrTx, poId: string) {
  return db
    .select({
      id: purchaseOrderLines.id, lineNo: purchaseOrderLines.lineNo, itemId: purchaseOrderLines.itemId, mrLineId: purchaseOrderLines.mrLineId,
      costCodeId: purchaseOrderLines.costCodeId, unitCode: purchaseOrderLines.unitCode, qty: purchaseOrderLines.qty, qtyBase: purchaseOrderLines.qtyBase,
      unitPrice: purchaseOrderLines.unitPrice, vatCode: purchaseOrderLines.vatCode, vatRate: purchaseOrderLines.vatRate,
      lineNet: purchaseOrderLines.lineNet, lineVat: purchaseOrderLines.lineVat, qtyCancelledBase: purchaseOrderLines.qtyCancelledBase,
      itemCode: items.code, itemDescription: items.description, baseUnit: items.baseUnit, costCode: costCodes.code,
      acceptedBase: sql<string>`coalesce((select sum(g.qty_accepted_base) from goods_receipt_lines g where g.po_line_id = ${purchaseOrderLines.id}), 0)`,
      rejectedBase: sql<string>`coalesce((select sum(g.qty_rejected_base) from goods_receipt_lines g where g.po_line_id = ${purchaseOrderLines.id}), 0)`,
      mrNumber: materialRequests.number, mrId: materialRequests.id,
    })
    .from(purchaseOrderLines)
    .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .innerJoin(costCodes, eq(costCodes.id, purchaseOrderLines.costCodeId))
    .leftJoin(materialRequestLines, eq(materialRequestLines.id, purchaseOrderLines.mrLineId))
    .leftJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
    .where(eq(purchaseOrderLines.purchaseOrderId, poId))
    .orderBy(asc(purchaseOrderLines.lineNo));
}

/** Removes prices and values for users without `rates.view` (enforced server-side, not just hidden in the UI). */
function redactPrices<T extends Record<string, unknown>>(actor: Actor, row: T, keys: string[]): T {
  if (can(actor, "rates.view")) return row;
  const copy: Record<string, unknown> = { ...row };
  for (const k of keys) if (k in copy) copy[k] = null;
  return copy as T;
}
const PO_PRICE_KEYS = ["subtotal", "vatAmount", "total"];
const LINE_PRICE_KEYS = ["unitPrice", "lineNet", "lineVat", "unitCostBase"];

export async function getPo(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "po.view");
  const [row] = await db
    .select({ po: purchaseOrders, projectCode: projects.code, projectName: projects.name, supplierName: companies.name, supplierTrn: companies.trn,
      locationCode: locations.code, locationName: locations.name, creatorName: users.fullName })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(companies, eq(companies.id, purchaseOrders.supplierId))
    .innerJoin(locations, eq(locations.id, purchaseOrders.deliveryLocationId))
    .innerJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(eq(purchaseOrders.id, id));
  if (!row) throw notFound("Purchase order");
  requireProject(actor, row.po.projectId, "Purchase order");
  const lines = (await poLinesWithReceipts(db, id)).map((l) => {
    const outstanding = Decimal.max(0, dec(l.qtyBase).minus(l.qtyCancelledBase).minus(l.acceptedBase));
    return redactPrices(actor, { ...l, outstandingBase: q4(outstanding) }, LINE_PRICE_KEYS);
  });
  const receipts = await db
    .select({ id: goodsReceipts.id, number: goodsReceipts.number, receivedDate: goodsReceipts.receivedDate, deliveryNoteRef: goodsReceipts.deliveryNoteRef,
      receivedByName: users.fullName, locationCode: locations.code })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .innerJoin(locations, eq(locations.id, goodsReceipts.locationId))
    .where(eq(goodsReceipts.purchaseOrderId, id))
    .orderBy(asc(goodsReceipts.postedAt));
  return {
    ...redactPrices(actor, { ...row.po }, PO_PRICE_KEYS),
    projectCode: row.projectCode, projectName: row.projectName, supplierName: row.supplierName, supplierTrn: row.supplierTrn,
    deliveryLocationCode: row.locationCode, deliveryLocationName: row.locationName, creatorName: row.creatorName,
    pricesVisible: can(actor, "rates.view"),
    lines, receipts,
    approvals: await approvalHistory(db, "purchase_order", id),
  };
}

export async function listPos(db: DbOrTx, actor: Actor, filter: { projectId?: string; status?: string; limit: number; offset: number }) {
  requirePerm(actor, "po.view");
  const scope = projectScope(actor);
  if (filter.projectId) requireProject(actor, filter.projectId, "Project");
  const rows = await db
    .select({
      id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, revision: purchaseOrders.revision,
      projectId: purchaseOrders.projectId, projectCode: projects.code, supplierName: companies.name, total: purchaseOrders.total,
      subtotal: purchaseOrders.subtotal, promisedDate: purchaseOrders.promisedDate, requiredDate: purchaseOrders.requiredDate, createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(companies, eq(companies.id, purchaseOrders.supplierId))
    .where(and(
      filter.projectId ? eq(purchaseOrders.projectId, filter.projectId) : undefined,
      scope ? (scope.length ? inArray(purchaseOrders.projectId, scope) : sql`false`) : undefined,
      filter.status ? eq(purchaseOrders.status, filter.status as never) : undefined,
    ))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
  return rows.map((r) => redactPrices(actor, r, ["total", "subtotal"]));
}

// ───────────────────────────── Goods receipt ─────────────────────────────

export interface ReceiptLineInput { poLineId: string; qtyReceived: string; qtyRejected?: string; rejectionReason?: string | null }
export interface ReceiptInput {
  idempotencyKey: string; receivedDate?: string; deliveryNoteRef?: string | null; notes?: string | null; lines: ReceiptLineInput[];
}

/**
 * Posts a (partial) delivery against an approved PO. Quantities are entered in the PO line's unit.
 *  - Accepted quantity → "available" stock at the PO delivery location, valued at PO price.
 *  - Rejected quantity → "rejected" stock (physically on site, not usable, not valued, awaiting return).
 *  - If the PO line was raised for a material request, accepted stock is reserved for that request.
 * Retrying with the same idempotency key returns the original receipt instead of posting twice.
 */
export async function receiveGoods(db: DB, actor: Actor, poId: string, input: ReceiptInput) {
  requirePerm(actor, "stock.receive");
  if (!input.idempotencyKey) throw rule("IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
  const existing = await findReceiptByKey(db, input.idempotencyKey);
  if (existing) {
    if (existing.purchaseOrderId !== poId) throw conflict("This submission key was already used for a different document.");
    requireProject(actor, existing.projectId, "Goods receipt");
    return { receipt: existing, replayed: true };
  }
  try {
    const receipt = await db.transaction(async (tx) => {
      const po = await lockPo(tx, actor, poId);
      if (!["approved", "partially_received"].includes(po.status)) throw rule("PO_NOT_RECEIVABLE", `Goods cannot be received against a ${po.status} purchase order.`);
      const loc = await requireLocation(tx, actor, po.deliveryLocationId);
      const poLines = await poLinesWithReceipts(tx, poId);
      if (!input.lines.length) throw rule("NO_LINES", "Enter at least one received quantity.");
      const date = input.receivedDate ?? businessToday();
      const number = await nextDocNumber(tx, "GRN");
      const [grn] = await tx.insert(goodsReceipts).values({
        number, purchaseOrderId: poId, projectId: po.projectId, locationId: po.deliveryLocationId, deliveryNoteRef: input.deliveryNoteRef ?? null,
        receivedDate: date, receivedBy: actor.userId, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey,
      }).returning();
      const seen = new Set<string>();
      for (const li of input.lines) {
        const pl = poLines.find((p) => p.id === li.poLineId);
        if (!pl) throw rule("INVALID_PO_LINE", "A receipt line does not belong to this purchase order.");
        if (seen.has(pl.id)) throw rule("DUPLICATE_LINE", `PO line ${pl.lineNo} appears twice.`);
        seen.add(pl.id);
        const factor = dec(pl.qtyBase).dividedBy(pl.qty); // base units per PO unit
        const received = dec(li.qtyReceived).times(factor);
        const rejected = dec(li.qtyRejected ?? 0).times(factor);
        if (received.lte(0)) throw rule("INVALID_QTY", `PO line ${pl.lineNo}: received quantity must be greater than zero.`);
        if (rejected.lt(0) || rejected.gt(received)) throw rule("INVALID_QTY", `PO line ${pl.lineNo}: rejected quantity must be between 0 and the received quantity.`);
        if (rejected.gt(0) && !li.rejectionReason?.trim()) throw rule("REJECTION_REASON_REQUIRED", `PO line ${pl.lineNo}: give a reason for the rejected quantity.`);
        const accepted = received.minus(rejected);
        const outstanding = dec(pl.qtyBase).minus(pl.qtyCancelledBase).minus(pl.acceptedBase);
        if (accepted.gt(outstanding)) {
          throw rule("OVER_RECEIPT", `PO line ${pl.lineNo}: accepting ${q4(accepted)} ${pl.baseUnit} exceeds the outstanding ${q4(outstanding)} ${pl.baseUnit}.`);
        }
        const unitCostBase = dec(pl.unitPrice).dividedBy(factor);
        const [gl] = await tx.insert(goodsReceiptLines).values({
          goodsReceiptId: grn.id, poLineId: pl.id, itemId: pl.itemId, qtyReceivedBase: q4(received), qtyAcceptedBase: q4(accepted),
          qtyRejectedBase: q4(rejected), rejectionReason: li.rejectionReason?.trim() || null, unitCostBase: q4(unitCostBase),
        }).returning();
        const common = {
          itemId: pl.itemId, locationId: loc.id, projectId: po.projectId, costCodeId: pl.costCodeId, sourceType: "goods_receipt",
          sourceId: grn.id, sourceLineId: gl.id, sourceNumber: number, movementDate: date, postedBy: actor.userId,
        };
        if (accepted.gt(0)) {
          await postMovement(tx, { ...common, movementType: "receipt", status: "available", qtyDelta: accepted, unitCost: unitCostBase });
          await valuationIn(tx, pl.itemId, accepted, unitCostBase);
          if (pl.mrLineId) {
            const f = (await lineFulfilment(tx, [pl.mrLineId])).get(pl.mrLineId)!;
            // f.onOrder already excludes this receipt; reserve what the request still needs.
            const need = Decimal.max(0, f.requested.minus(f.issued).minus(f.reserved).minus(f.inTransit).minus(f.onOrder));
            const reserve = Decimal.min(accepted, need);
            if (reserve.gt(0)) {
              await tx.insert(reservations).values({
                itemId: pl.itemId, locationId: loc.id, mrLineId: pl.mrLineId, qty: q4(reserve), status: "active", source: "receipt", createdBy: actor.userId,
              });
            }
          }
        }
        if (rejected.gt(0)) {
          await postMovement(tx, { ...common, movementType: "receipt_rejected", status: "rejected", qtyDelta: rejected, unitCost: 0, valueDelta: 0, note: li.rejectionReason });
        }
      }
      // PO status from the updated receipts
      const after = await poLinesWithReceipts(tx, poId);
      const complete = after.every((l) => dec(l.qtyBase).minus(l.qtyCancelledBase).minus(l.acceptedBase).lte(0));
      await tx.update(purchaseOrders).set({ status: complete ? "received" : "partially_received", version: po.version + 1, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, poId));
      await audit(tx, actor, "stock.received", "goods_receipt", grn.id, po.projectId, { number, po: po.number, lines: input.lines.length });
      return grn;
    });
    return { receipt, replayed: false };
  } catch (err) {
    // A concurrent retry with the same key won the race: return the receipt it created.
    if (pgConstraint(err) === "goods_receipts_idem_unique") {
      const winner = await findReceiptByKey(db, input.idempotencyKey);
      if (winner && winner.purchaseOrderId === poId) return { receipt: winner, replayed: true };
    }
    throw err;
  }
}

async function findReceiptByKey(db: DbOrTx, key: string) {
  const [r] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.idempotencyKey, key));
  return r ?? null;
}

export async function getReceipt(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "po.view");
  const [row] = await db
    .select({ grn: goodsReceipts, poNumber: purchaseOrders.number, projectCode: projects.code, supplierName: companies.name, locationCode: locations.code, receivedByName: users.fullName })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
    .innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
    .innerJoin(companies, eq(companies.id, purchaseOrders.supplierId))
    .innerJoin(locations, eq(locations.id, goodsReceipts.locationId))
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(eq(goodsReceipts.id, id));
  if (!row) throw notFound("Goods receipt");
  requireProject(actor, row.grn.projectId, "Goods receipt");
  const lines = await db
    .select({ line: goodsReceiptLines, itemCode: items.code, itemDescription: items.description, baseUnit: items.baseUnit, poLineNo: purchaseOrderLines.lineNo })
    .from(goodsReceiptLines)
    .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, goodsReceiptLines.poLineId))
    .where(eq(goodsReceiptLines.goodsReceiptId, id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  return {
    ...row.grn, poNumber: row.poNumber, projectCode: row.projectCode, supplierName: row.supplierName, locationCode: row.locationCode, receivedByName: row.receivedByName,
    lines: lines.map((l) => redactPrices(actor, { ...l.line, itemCode: l.itemCode, itemDescription: l.itemDescription, baseUnit: l.baseUnit, poLineNo: l.poLineNo }, LINE_PRICE_KEYS)),
  };
}
