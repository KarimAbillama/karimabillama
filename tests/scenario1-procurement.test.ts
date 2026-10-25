/**
 * Acceptance scenario 1: request 100 → reserve 40 from warehouse → PO for 60 → deliver 50 with 5
 * rejected → 45 available, 5 rejected, 15 outstanding → issue only authorised available stock.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "../server/db/client.js";
import { approve, fixtures, freshDb, opening, type Fx } from "./helpers.js";
import { createMr, getMr, reserveForLine, submitMr } from "../server/services/materialRequests.js";
import { createPo, getPo, receiveGoods, submitPo } from "../server/services/purchasing.js";
import { issueStock, stockPosition } from "../server/services/inventory.js";
import { drillRows, projectReport } from "../server/services/reports.js";

let db: DB;
let fx: Fx;

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  await opening(db, fx, fx.board.id, fx.whA.id, "40", "20");
});

describe("Scenario 1 — request, reserve, order, partial receipt with rejection, issue", () => {
  let mrLineId: string;
  let poId: string;
  let poLineId: string;

  it("site engineer raises a request for 100 that the PM approves", async () => {
    const { engineerA, pmA } = fx.actors;
    const mr = await createMr(db, engineerA, { projectId: fx.projA.id, siteId: fx.siteA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "100", costCodeId: fx.costCodeId }] });
    expect(mr.number).toMatch(/^MR-\d{4}-00001$/);
    await submitMr(db, engineerA, mr.id);
    await approve(db, mr.id, pmA);
    const d = await getMr(db, pmA, mr.id);
    expect(d.status).toBe("approved");
    mrLineId = d.lines[0].id;
    expect(d.lines[0].fulfilment?.uncovered).toBe("100.0000");
  });

  it("reserves the 40 available warehouse units and cannot over-reserve", async () => {
    await expect(reserveForLine(db, fx.actors.store, mrLineId, fx.whA.id, "41")).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await reserveForLine(db, fx.actors.store, mrLineId, fx.whA.id, "40");
    const d = await getMr(db, fx.actors.pmA, (await lineMr()).id);
    expect(d.lines[0].fulfilment).toMatchObject({ reserved: "40.0000", uncovered: "60.0000" });
  });

  it("raises a PO for the 60 shortage and blocks ordering more than the shortage", async () => {
    const base = { projectId: fx.projA.id, supplierId: fx.supplier.id, deliveryLocationId: fx.ssA.id };
    const line = { itemId: fx.board.id, mrLineId, costCodeId: fx.costCodeId, unitCode: "pcs", unitPrice: "25", vatCode: "SR" as const };
    await expect(createPo(db, fx.actors.proc, { ...base, lines: [{ ...line, qty: "61" }] })).rejects.toMatchObject({ code: "OVER_ORDER" });
    const po = await createPo(db, fx.actors.proc, { ...base, lines: [{ ...line, qty: "60" }] });
    expect(po.subtotal).toBe("1500.00");
    expect(po.vatAmount).toBe("75.00");
    await submitPo(db, fx.actors.proc, po.id);
    await approve(db, po.id, fx.actors.pmA);
    poId = po.id;
    poLineId = (await getPo(db, fx.actors.proc, po.id)).lines[0].id;
  });

  it("receives 50 with 5 rejected: 45 available + reserved, 5 rejected, 15 outstanding", async () => {
    await expect(receiveGoods(db, fx.actors.engineerA, poId, {
      idempotencyKey: "grn-1-bad", lines: [{ poLineId, qtyReceived: "50", qtyRejected: "5" }],
    })).rejects.toMatchObject({ code: "REJECTION_REASON_REQUIRED" });

    const res = await receiveGoods(db, fx.actors.engineerA, poId, {
      idempotencyKey: "grn-1", deliveryNoteRef: "DN-1", lines: [{ poLineId, qtyReceived: "50", qtyRejected: "5", rejectionReason: "Cracked" }],
    });
    expect(res.replayed).toBe(false);

    const po = await getPo(db, fx.actors.proc, poId);
    expect(po.status).toBe("partially_received");
    expect(po.lines[0]).toMatchObject({ acceptedBase: "45.0000", rejectedBase: "5.0000", outstandingBase: "15.0000" });

    const pos = await stockPosition(db, fx.actors.store, { locationId: fx.ssA.id });
    expect(pos[0]).toMatchObject({ available: "45.0000", rejected: "5.0000", reserved: "45.0000", free: "0.0000" });

    const mr = await getMr(db, fx.actors.pmA, (await lineMr()).id);
    expect(mr.lines[0].fulfilment).toMatchObject({ reserved: "85.0000", onOrder: "15.0000", uncovered: "0.0000" });
  });

  it("cannot accept more than the outstanding 15", async () => {
    await expect(receiveGoods(db, fx.actors.engineerA, poId, { idempotencyKey: "grn-2", lines: [{ poLineId, qtyReceived: "16" }] }))
      .rejects.toMatchObject({ code: "OVER_RECEIPT" });
  });

  it("issues only available authorised quantities and keeps all links", async () => {
    const { store } = fx.actors;
    // 50 is more than the 45 usable at the site store (rejected units are not usable)
    await expect(issueStock(db, store, { idempotencyKey: "iss-too-much", locationId: fx.ssA.id, issuedTo: "Crew", lines: [{ mrLineId, qty: "50" }] }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    const res = await issueStock(db, store, { idempotencyKey: "iss-1", locationId: fx.ssA.id, issuedTo: "Drywall crew", lines: [{ mrLineId, qty: "45" }] });
    expect(res.issue.number).toMatch(/^ISS-/);
    await issueStock(db, store, { idempotencyKey: "iss-2", locationId: fx.whA.id, issuedTo: "Drywall crew", lines: [{ mrLineId, qty: "40" }] });

    const mr = await getMr(db, fx.actors.pmA, (await lineMr()).id);
    expect(mr.lines[0].fulfilment).toMatchObject({ issued: "85.0000", reserved: "0.0000", onOrder: "15.0000", uncovered: "0.0000" });

    // the request line cannot be over-issued even with free stock
    await opening(db, fx, fx.board.id, fx.whA.id, "100", "20");
    await expect(issueStock(db, store, { idempotencyKey: "iss-3", locationId: fx.whA.id, issuedTo: "Crew", lines: [{ mrLineId, qty: "16" }] }))
      .rejects.toMatchObject({ code: "OVER_ISSUE" });
  });

  it("costs: commitment, receipt and issue are distinct; issued cost traces to source", async () => {
    const report = await projectReport(db, fx.actors.pmA, fx.projA.id);
    expect(report.summary.committed).toBe("1500.00"); // 60 × 25
    expect(report.summary.receivedValue).toBe("1125.00"); // 45 × 25
    expect(report.summary.openCommitment).toBe("375.00"); // 15 × 25
    // issued: 45 + 40 boards at moving average cost (40@20 opening, 45@25 receipt → avg 22.647...)
    const issued = await drillRows(db, fx.projA.id, "issued");
    expect(issued).toHaveLength(2);
    expect(report.summary.issuedCost).toBe(issued.reduce((a, r) => (Number(a) + Number(r.value)).toFixed(2), "0"));
    expect(report.summary.invoiced).toBeNull(); // not tracked yet, shown as missing, never zero
  });

  async function lineMr() {
    const { materialRequestLines } = await import("../server/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [l] = await db.select().from(materialRequestLines).where(eq(materialRequestLines.id, mrLineId));
    return { id: l.materialRequestId };
  }
});
