/** Unit conversions, and scenario 10: report totals reconcile with the ledger and the drill-down. */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DB } from "../server/db/client.js";
import { toBaseQty } from "../server/lib/units.js";
import { UNIT_DEFS } from "../server/db/baseSeed.js";
import { approve, fixtures, freshDb, opening, type Fx } from "./helpers.js";
import { createMr, getMr, submitMr } from "../server/services/materialRequests.js";
import { createPo, getPo, receiveGoods, submitPo } from "../server/services/purchasing.js";
import { issueStock } from "../server/services/inventory.js";
import { drillRows, projectReport } from "../server/services/reports.js";
import { sum } from "../server/lib/decimal.js";

const units = UNIT_DEFS.map((u) => ({ ...u, factorToReference: u.factorToReference }));
const ctx = (baseUnit: string, conversions: { unitCode: string; baseUnitsPerUnit: string }[] = []) => ({ itemCode: "X", baseUnit, conversions, units });

describe("unit conversion", () => {
  it("converts within a dimension using standard factors", () => {
    expect(toBaseQty(ctx("kg"), "t", "2.5").toFixed(4)).toBe("2500.0000");
    expect(toBaseQty(ctx("m"), "mm", "1250").toFixed(4)).toBe("1.2500");
    expect(toBaseQty(ctx("m3"), "l", "500").toFixed(4)).toBe("0.5000");
  });
  it("uses item-specific packaging conversions", () => {
    expect(toBaseQty(ctx("m2", [{ unitCode: "box", baseUnitsPerUnit: "1.44" }]), "box", "10").toFixed(4)).toBe("14.4000");
  });
  it("refuses conversions between different dimensions without an item factor", () => {
    expect(() => toBaseQty(ctx("m2"), "kg", "1")).toThrow(/Cannot convert/);
    expect(() => toBaseQty(ctx("pcs"), "box", "1")).toThrow(/Cannot convert/);
    expect(() => toBaseQty(ctx("pcs"), "furlong", "1")).toThrow(/Unknown unit/);
  });
});

describe("Scenario 10 — totals reconcile with the ledger and drill-down", () => {
  let db: DB;
  let fx: Fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await fixtures(db);
    await opening(db, fx, fx.tile.id, fx.whA.id, "100", "30");
    const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.tile.id, qty: "288", costCodeId: fx.costCodeId }] });
    await submitMr(db, fx.actors.engineerA, mr.id);
    await approve(db, mr.id, fx.actors.pmA);
    const line = (await getMr(db, fx.actors.pmA, mr.id)).lines[0].id;
    // 100 boxes × 1.44 = 144 m2 at AED 50/box (= 34.7222 per m2)
    const po = await createPo(db, fx.actors.proc, {
      projectId: fx.projA.id, supplierId: fx.supplier.id, deliveryLocationId: fx.ssA.id,
      lines: [{ itemId: fx.tile.id, mrLineId: line, costCodeId: fx.costCodeId, unitCode: "box", qty: "100", unitPrice: "50", vatCode: "SR" }],
    });
    await submitPo(db, fx.actors.proc, po.id);
    await approve(db, po.id, fx.actors.pmA);
    const pl = (await getPo(db, fx.actors.proc, po.id)).lines[0];
    expect(pl.qtyBase).toBe("144.0000");
    await receiveGoods(db, fx.actors.engineerA, po.id, { idempotencyKey: "rec-1", lines: [{ poLineId: pl.id, qtyReceived: "60" }] });
    await issueStock(db, fx.actors.store, { idempotencyKey: "iss-r1", locationId: fx.ssA.id, issuedTo: "Tiling crew", lines: [{ mrLineId: line, qty: "50" }] });
    await issueStock(db, fx.actors.store, { idempotencyKey: "iss-r2", locationId: fx.whA.id, issuedTo: "Tiling crew", lines: [{ mrLineId: line, qty: "30.5" }] });
  });

  it("report figures equal their drill-down rows and the stock ledger", async () => {
    const r = await projectReport(db, fx.actors.pmA, fx.projA.id);
    for (const [metric, value] of [["committed", r.summary.committed], ["received", r.summary.receivedValue], ["issued", r.summary.issuedCost]] as const) {
      const rows = await drillRows(db, fx.projA.id, metric);
      expect(sum(rows.map((x) => x.value)).toFixed(2)).toBe(value);
    }
    expect(r.summary.committed).toBe("5000.00");
    expect(r.summary.receivedValue).toBe("3000.00"); // 86.4 m2 accepted × 34.7222… = 60 boxes × 50
    const ledgerIssued = await db.execute<{ v: string }>(sql`select (-sum(value_delta))::numeric(18,2) as v from stock_movements where project_id = ${fx.projA.id} and movement_type = 'issue'`);
    expect(ledgerIssued.rows[0].v).toBe(r.summary.issuedCost);
    const byCcIssued = sum(r.byCostCode.map((c) => c.issued ?? 0)).toFixed(2);
    expect(byCcIssued).toBe(r.summary.issuedCost);
    // stock quantities: ledger sum equals balances for every item/location/status
    const mismatch = await db.execute(sql`
      select b.item_id from stock_balances b
      left join (select item_id, location_id, status, sum(qty_delta) q from stock_movements group by 1,2,3) m
        on m.item_id = b.item_id and m.location_id = b.location_id and m.status = b.status
      where b.qty <> coalesce(m.q, 0)`);
    expect(mismatch.rows).toHaveLength(0);
  });
});
