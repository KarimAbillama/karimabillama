/**
 * Acceptance scenario 2: dispatch 20 from Warehouse A → shows in transit → Site B receives 18 →
 * 2 go to a discrepancy workflow. Global stock reconciles; no invented receipt or duplicate cost.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DB } from "../server/db/client.js";
import { fixtures, freshDb, opening, type Fx } from "./helpers.js";
import { dispatchTransfer, getTransfer, receiveTransfer, resolveDiscrepancy, stockPosition } from "../server/services/inventory.js";

let db: DB;
let fx: Fx;

const globalQty = async (itemId: string) =>
  (await db.execute<{ q: string }>(sql`select coalesce(sum(qty),0)::numeric(18,4) as q from stock_balances where item_id = ${itemId}`)).rows[0].q;
const ledgerQty = async (itemId: string) =>
  (await db.execute<{ q: string }>(sql`select coalesce(sum(qty_delta),0)::numeric(18,4) as q from stock_movements where item_id = ${itemId}`)).rows[0].q;
const valuation = async (itemId: string) =>
  (await db.execute<{ valued_qty: string; avg_unit_cost: string }>(sql`select valued_qty, avg_unit_cost from item_valuations where item_id = ${itemId}`)).rows[0];

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  await opening(db, fx, fx.board.id, fx.whA.id, "100", "12");
});

describe("Scenario 2 — transfer with in-transit stock and a short receipt", () => {
  let transferId: string;
  let lineId: string;

  it("dispatch puts 20 in transit; destination does not change yet", async () => {
    const res = await dispatchTransfer(db, fx.actors.store, {
      idempotencyKey: "trf-1", fromLocationId: fx.whA.id, toLocationId: fx.ssB.id, lines: [{ itemId: fx.board.id, qty: "20" }],
    });
    transferId = res.transfer.id;
    const t = await getTransfer(db, fx.actors.store, transferId);
    lineId = t.lines[0].id;
    expect(t.status).toBe("in_transit");
    const wh = await stockPosition(db, fx.actors.store, { locationId: fx.whA.id });
    expect(wh[0].available).toBe("80.0000");
    const ss = await stockPosition(db, fx.actors.store, { locationId: fx.ssB.id });
    expect(ss).toHaveLength(0);
    expect(await globalQty(fx.board.id)).toBe("100.0000");
  });

  it("a retry of the same dispatch does not move stock twice", async () => {
    const again = await dispatchTransfer(db, fx.actors.store, {
      idempotencyKey: "trf-1", fromLocationId: fx.whA.id, toLocationId: fx.ssB.id, lines: [{ itemId: fx.board.id, qty: "20" }],
    });
    expect(again.replayed).toBe(true);
    expect((await stockPosition(db, fx.actors.store, { locationId: fx.whA.id }))[0].available).toBe("80.0000");
  });

  it("a user without access to the destination cannot receive", async () => {
    await expect(receiveTransfer(db, fx.actors.storeA, transferId, { idempotencyKey: "rcv-x", lines: [{ lineId, qtyReceived: "18", note: "x" }] }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("short receipt needs a note; 18 arrive and 2 enter discrepancy", async () => {
    await expect(receiveTransfer(db, fx.actors.store, transferId, { idempotencyKey: "rcv-1", lines: [{ lineId, qtyReceived: "18" }] }))
      .rejects.toMatchObject({ code: "DISCREPANCY_NOTE_REQUIRED" });
    await receiveTransfer(db, fx.actors.store, transferId, { idempotencyKey: "rcv-1", lines: [{ lineId, qtyReceived: "18", note: "2 missing on arrival" }] });
    const t = await getTransfer(db, fx.actors.store, transferId);
    expect(t.status).toBe("received_with_discrepancy");
    expect(t.lines[0]).toMatchObject({ qtyReceived: "18.0000", qtyDiscrepancy: "2.0000", discrepancyStatus: "open" });
    expect((await stockPosition(db, fx.actors.store, { locationId: fx.ssB.id }))[0].available).toBe("18.0000");
    // nothing vanished: 80 + 18 + 2 under investigation
    expect(await globalQty(fx.board.id)).toBe("100.0000");
    expect(await ledgerQty(fx.board.id)).toBe("100.0000");
    // receiving twice is impossible; the same key replays
    const replay = await receiveTransfer(db, fx.actors.store, transferId, { idempotencyKey: "rcv-1", lines: [{ lineId, qtyReceived: "18", note: "x" }] });
    expect(replay.replayed).toBe(true);
    await expect(receiveTransfer(db, fx.actors.store, transferId, { idempotencyKey: "rcv-2", lines: [{ lineId, qtyReceived: "18", note: "x" }] }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("write-off needs stock.adjust and reduces inventory value, not project cost", async () => {
    await expect(resolveDiscrepancy(db, fx.actors.store, lineId, "written_off", "Lost")).rejects.toMatchObject({ status: 403 });
    const before = await valuation(fx.board.id);
    expect(before.valued_qty).toBe("100.0000");
    await resolveDiscrepancy(db, fx.actors.ops, lineId, "written_off", "Confirmed lost in transit");
    expect(await globalQty(fx.board.id)).toBe("98.0000");
    expect((await valuation(fx.board.id)).valued_qty).toBe("98.0000");
    const projectCost = await db.execute<{ n: number }>(sql`select count(*)::int as n from stock_movements where project_id is not null and movement_type = 'issue'`);
    expect(projectCost.rows[0].n).toBe(0);
    await expect(resolveDiscrepancy(db, fx.actors.ops, lineId, "found", "again")).rejects.toMatchObject({ status: 409 });
  });

  it("the ledger cannot be edited or deleted", async () => {
    // drizzle wraps the Postgres error; the trigger's message is on `cause`
    await expect(db.execute(sql`update stock_movements set qty_delta = 999`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    await expect(db.execute(sql`delete from stock_movements`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
  });
});
