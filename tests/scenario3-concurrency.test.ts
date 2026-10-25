/**
 * Acceptance scenario 3: two users issue the last 10 units at the same moment — only a valid total
 * posts. A network retry with the same idempotency key cannot create a second issue.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DB } from "../server/db/client.js";
import { approve, fixtures, freshDb, opening, type Fx } from "./helpers.js";
import { createMr, getMr, submitMr } from "../server/services/materialRequests.js";
import { issueStock, stockPosition } from "../server/services/inventory.js";
import { nextDocNumber } from "../server/lib/numbering.js";
import { balanceOf } from "../server/services/stock.js";

let db: DB;
let fx: Fx;
let lineA: string;
let lineB: string;

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  await opening(db, fx, fx.board.id, fx.ssA.id, "10", "5");
  const mk = async () => {
    const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "10", costCodeId: fx.costCodeId }] });
    await submitMr(db, fx.actors.engineerA, mr.id);
    await approve(db, mr.id, fx.actors.pmA);
    return (await getMr(db, fx.actors.pmA, mr.id)).lines[0].id;
  };
  lineA = await mk();
  lineB = await mk();
});

describe("Scenario 3 — concurrency and idempotency", () => {
  it("only one of two simultaneous issues of the last 10 units succeeds", async () => {
    const results = await Promise.allSettled([
      issueStock(db, fx.actors.store, { idempotencyKey: "race-a", locationId: fx.ssA.id, issuedTo: "Crew A", lines: [{ mrLineId: lineA, qty: "10" }] }),
      issueStock(db, fx.actors.storeA, { idempotencyKey: "race-b", locationId: fx.ssA.id, issuedTo: "Crew B", lines: [{ mrLineId: lineB, qty: "10" }] }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect((await balanceOf(db, fx.board.id, fx.ssA.id, "available")).toFixed(4)).toBe("0.0000");
  });

  it("many parallel partial issues never exceed stock", async () => {
    await opening(db, fx, fx.board.id, fx.ssA.id, "7", "5");
    const line = (await db.execute<{ id: string }>(sql`
      select l.id from material_request_lines l where not exists (select 1 from stock_issue_lines i where i.mr_line_id = l.id) limit 1`)).rows[0].id;
    const attempts = Array.from({ length: 6 }, (_, i) =>
      issueStock(db, fx.actors.store, { idempotencyKey: `par-${i}`, locationId: fx.ssA.id, issuedTo: "Crew", lines: [{ mrLineId: line, qty: "2" }] }));
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3); // 3 × 2 = 6 ≤ 7
    expect((await balanceOf(db, fx.board.id, fx.ssA.id, "available")).toFixed(4)).toBe("1.0000");
  });

  it("a retried submission with the same key returns the original issue", async () => {
    await opening(db, fx, fx.board.id, fx.whA.id, "50", "5");
    const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "5", costCodeId: fx.costCodeId }] });
    await submitMr(db, fx.actors.engineerA, mr.id);
    await approve(db, mr.id, fx.actors.pmA);
    const line = (await getMr(db, fx.actors.pmA, mr.id)).lines[0].id;
    const input = { idempotencyKey: "retry-1", locationId: fx.whA.id, issuedTo: "Crew", lines: [{ mrLineId: line, qty: "5" }] };
    const [a, b] = await Promise.all([issueStock(db, fx.actors.store, input), issueStock(db, fx.actors.store, input)]);
    expect(a.issue.id).toBe(b.issue.id);
    const c = await issueStock(db, fx.actors.store, input);
    expect(c.replayed).toBe(true);
    expect(c.issue.id).toBe(a.issue.id);
    const n = await db.execute<{ n: number }>(sql`select count(*)::int as n from stock_movements where source_id = ${a.issue.id}`);
    expect(n.rows[0].n).toBe(1);
    expect((await stockPosition(db, fx.actors.store, { locationId: fx.whA.id }))[0].available).toBe("45.0000");
  });

  it("document numbers stay unique under concurrency", async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => db.transaction((tx) => nextDocNumber(tx, "TRF"))));
    expect(new Set(nums).size).toBe(20);
  });
});
