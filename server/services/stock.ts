/**
 * Stock ledger primitives. Every change to stock goes through `postMovement`, which appends an
 * immutable ledger row and updates the running balance in the same transaction. The balance table
 * has a CHECK (qty >= 0), so a posting that would make stock negative fails and rolls back.
 *
 * Concurrency: callers lock the balance rows they are about to consume with `lockBalance`
 * (SELECT … FOR UPDATE) before checking availability. A second user trying to issue the same
 * units waits for the first transaction, then re-reads the reduced balance.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "../db/client.js";
import { itemValuations, locations, reservations, stockBalances, stockMovements, type MovementType, type StockStatus } from "../db/schema.js";
import { Decimal, dec, m2, q4 } from "../lib/decimal.js";
import { pgConstraint, rule } from "../lib/errors.js";

export interface MovementInput {
  movementType: MovementType;
  itemId: string;
  locationId: string;
  status: StockStatus;
  qtyDelta: Decimal.Value;
  unitCost?: Decimal.Value;
  /** Defaults to qtyDelta × unitCost. Pass 0 for movements that do not change inventory value. */
  valueDelta?: Decimal.Value;
  projectId?: string | null;
  costCodeId?: string | null;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string | null;
  sourceNumber: string;
  movementDate: string;
  postedBy: string;
  note?: string | null;
}

export async function postMovement(tx: Tx, m: MovementInput) {
  const qty = dec(m.qtyDelta);
  if (qty.isZero()) return;
  const unitCost = dec(m.unitCost ?? 0);
  const value = m.valueDelta !== undefined ? dec(m.valueDelta) : qty.times(unitCost);
  await tx.insert(stockMovements).values({
    movementType: m.movementType,
    itemId: m.itemId,
    locationId: m.locationId,
    status: m.status,
    qtyDelta: q4(qty),
    unitCost: q4(unitCost),
    valueDelta: m2(value),
    projectId: m.projectId ?? null,
    costCodeId: m.costCodeId ?? null,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    sourceLineId: m.sourceLineId ?? null,
    sourceNumber: m.sourceNumber,
    movementDate: m.movementDate,
    postedBy: m.postedBy,
    note: m.note ?? null,
  });
  try {
    if (qty.gt(0)) {
      await tx.execute(sql`
        insert into stock_balances (item_id, location_id, status, qty)
        values (${m.itemId}, ${m.locationId}, ${m.status}, ${q4(qty)})
        on conflict (item_id, location_id, status) do update set qty = stock_balances.qty + excluded.qty`);
    } else {
      // CHECK constraints are evaluated on the proposed INSERT row, so decrements must be plain UPDATEs.
      const res = await tx.execute(sql`
        update stock_balances set qty = qty + ${q4(qty)}
        where item_id = ${m.itemId} and location_id = ${m.locationId} and status = ${m.status}`);
      if (!res.rowCount) throw rule("INSUFFICIENT_STOCK", "Not enough stock at this location. Negative stock is not allowed.");
    }
  } catch (err) {
    if (pgConstraint(err) === "stock_balances_nonnegative") {
      throw rule("INSUFFICIENT_STOCK", "Not enough stock at this location. Negative stock is not allowed.");
    }
    throw err;
  }
}

/** Locks (creating if needed) the balance row and returns its quantity. Call inside a transaction. */
export async function lockBalance(tx: Tx, itemId: string, locationId: string, status: StockStatus): Promise<Decimal> {
  await tx.execute(sql`
    insert into stock_balances (item_id, location_id, status, qty) values (${itemId}, ${locationId}, ${status}, 0)
    on conflict do nothing`);
  const res = await tx.execute<{ qty: string }>(sql`
    select qty from stock_balances
    where item_id = ${itemId} and location_id = ${locationId} and status = ${status}
    for update`);
  return dec(res.rows[0].qty);
}

/** Open (unconsumed) reserved quantity at a location, optionally excluding one MR line's reservations. */
export async function reservedQty(db: DbOrTx, itemId: string, locationId: string, excludeMrLineId?: string): Promise<Decimal> {
  const res = await db.execute<{ q: string | null }>(sql`
    select coalesce(sum(qty - qty_consumed), 0) as q from reservations
    where item_id = ${itemId} and location_id = ${locationId} and status = 'active'
    ${excludeMrLineId ? sql`and mr_line_id <> ${excludeMrLineId}` : sql``}`);
  return dec(res.rows[0].q);
}

/** Active reservations held by one MR line at one location, oldest first, locked for update. */
export async function lockOwnReservations(tx: Tx, mrLineId: string, locationId: string) {
  const res = await tx.execute<{ id: string; qty: string; qty_consumed: string }>(sql`
    select id, qty, qty_consumed from reservations
    where mr_line_id = ${mrLineId} and location_id = ${locationId} and status = 'active'
    order by created_at
    for update`);
  return res.rows.map((r) => ({ id: r.id, open: dec(r.qty).minus(r.qty_consumed), consumed: dec(r.qty_consumed), qty: dec(r.qty) }));
}

/** Consumes up to `qty` of an MR line's reservations at a location. Returns the quantity consumed. */
export async function consumeReservations(tx: Tx, mrLineId: string, locationId: string, qty: Decimal): Promise<Decimal> {
  let remaining = qty;
  for (const r of await lockOwnReservations(tx, mrLineId, locationId)) {
    if (remaining.lte(0)) break;
    const take = Decimal.min(remaining, r.open);
    const newConsumed = r.consumed.plus(take);
    await tx
      .update(reservations)
      .set({ qtyConsumed: q4(newConsumed), status: newConsumed.gte(r.qty) ? "consumed" : "active" })
      .where(eq(reservations.id, r.id));
    remaining = remaining.minus(take);
  }
  return qty.minus(remaining);
}

// ───────────── Valuation (PROPOSED moving weighted-average cost; see docs/ASSUMPTIONS.md) ─────────────

async function lockValuation(tx: Tx, itemId: string) {
  await tx.insert(itemValuations).values({ itemId }).onConflictDoNothing();
  const res = await tx.execute<{ avg_unit_cost: string; valued_qty: string }>(sql`
    select avg_unit_cost, valued_qty from item_valuations where item_id = ${itemId} for update`);
  return { avg: dec(res.rows[0].avg_unit_cost), qty: dec(res.rows[0].valued_qty) };
}

/** Adds accepted stock at a purchase cost and recomputes the moving average. */
export async function valuationIn(tx: Tx, itemId: string, qty: Decimal, unitCost: Decimal) {
  const v = await lockValuation(tx, itemId);
  const newQty = v.qty.plus(qty);
  const newAvg = newQty.isZero() ? unitCost : v.qty.times(v.avg).plus(qty.times(unitCost)).dividedBy(newQty);
  await tx.update(itemValuations).set({ avgUnitCost: q4(newAvg), valuedQty: q4(newQty), updatedAt: new Date() }).where(eq(itemValuations.itemId, itemId));
}

/** Removes stock (issue to project or write-off) at the current average cost. Returns that unit cost. */
export async function valuationOut(tx: Tx, itemId: string, qty: Decimal): Promise<Decimal> {
  const v = await lockValuation(tx, itemId);
  if (v.qty.lt(qty)) throw rule("VALUATION_MISMATCH", "Valued quantity is lower than the quantity being removed.");
  await tx.update(itemValuations).set({ valuedQty: q4(v.qty.minus(qty)), updatedAt: new Date() }).where(eq(itemValuations.itemId, itemId));
  return v.avg;
}

export async function currentAvgCost(db: DbOrTx, itemId: string): Promise<Decimal> {
  const [v] = await db.select().from(itemValuations).where(eq(itemValuations.itemId, itemId));
  return dec(v?.avgUnitCost ?? 0);
}

export async function transitLocationId(db: DbOrTx): Promise<string> {
  const [loc] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.type, "transit"), eq(locations.isActive, true)));
  if (!loc) throw new Error("System transit location is missing; run the seed or create one.");
  return loc.id;
}

export async function balanceOf(db: DbOrTx, itemId: string, locationId: string, status: StockStatus): Promise<Decimal> {
  const [b] = await db
    .select({ qty: stockBalances.qty })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId), eq(stockBalances.status, status)));
  return dec(b?.qty ?? 0);
}
