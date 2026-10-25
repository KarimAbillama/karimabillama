/** Approval rules: thresholds, sequential steps, self-approval, segregation, revision invalidation (scenario 8 part). */
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "../server/db/client.js";
import { approve, fixtures, freshDb, type Fx } from "./helpers.js";
import { createMr, getMr, reviseMr, submitMr, updateMr } from "../server/services/materialRequests.js";
import { createPo, getPo, revisePo, submitPo, updatePo } from "../server/services/purchasing.js";
import { decide, myPendingApprovals } from "../server/services/approvals.js";

let db: DB;
let fx: Fx;
let mrLine: string;

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "10000", costCodeId: fx.costCodeId }] });
  await submitMr(db, fx.actors.engineerA, mr.id);
  await approve(db, mr.id, fx.actors.pmA);
  mrLine = (await getMr(db, fx.actors.pmA, mr.id)).lines[0].id;
});

const poInput = (qty: string, price: string) => ({
  projectId: fx.projA.id, supplierId: fx.supplier.id, deliveryLocationId: fx.ssA.id,
  lines: [{ itemId: fx.board.id, mrLineId: mrLine, costCodeId: fx.costCodeId, unitCode: "pcs", qty, unitPrice: price, vatCode: "SR" as const }],
});

describe("approvals", () => {
  it("a requester cannot approve their own request even with the approver role", async () => {
    const po = await createPo(db, fx.actors.pmAndProc, poInput("10", "100"));
    await submitPo(db, fx.actors.pmAndProc, po.id);
    expect((await myPendingApprovals(db, fx.actors.pmAndProc)).find((p) => p.docId === po.id)).toBeUndefined();
    const req = (await myPendingApprovals(db, fx.actors.pmA)).find((p) => p.docId === po.id)!;
    await expect(db.transaction((tx) => decide(tx, fx.actors.pmAndProc, req.requestId, "approve", undefined))).rejects.toMatchObject({ status: 403 });
    await db.transaction((tx) => decide(tx, fx.actors.pmA, req.requestId, "approve", undefined));
    expect((await getPo(db, fx.actors.proc, po.id)).status).toBe("approved");
  });

  it("users outside the project cannot see or decide its approvals", async () => {
    const po = await createPo(db, fx.actors.proc, poInput("1", "10"));
    await submitPo(db, fx.actors.proc, po.id);
    expect((await myPendingApprovals(db, fx.actors.pmB)).find((p) => p.docId === po.id)).toBeUndefined();
    const req = (await myPendingApprovals(db, fx.actors.pmA)).find((p) => p.docId === po.id)!;
    await expect(db.transaction((tx) => decide(tx, fx.actors.pmB, req.requestId, "approve", undefined))).rejects.toMatchObject({ status: 404 });
  });

  it("value thresholds add sequential steps; each step needs its role", async () => {
    const po = await createPo(db, fx.actors.proc, poInput("1500", "50")); // AED 75,000 → PM then Ops
    await submitPo(db, fx.actors.proc, po.id);
    expect((await myPendingApprovals(db, fx.actors.ops)).find((p) => p.docId === po.id)).toBeUndefined(); // waits for PM first
    await approve(db, po.id, fx.actors.pmA);
    expect((await getPo(db, fx.actors.proc, po.id)).status).toBe("pending_approval");
    await approve(db, po.id, fx.actors.ops);
    const d = await getPo(db, fx.actors.proc, po.id);
    expect(d.status).toBe("approved");
    expect(d.approvals[0].steps.map((s) => [s.roleKey, s.status, s.docRevision])).toEqual([["project_manager", "approved", 0], ["operations_manager", "approved", 0]]);
  });

  it("the same person cannot approve two steps", async () => {
    const both = await (async () => {
      const { loadActor } = await import("../server/auth/actor.js");
      const { roles, userRoles } = await import("../server/db/schema.js");
      const { eq } = await import("drizzle-orm");
      const [r] = await db.select().from(roles).where(eq(roles.key, "operations_manager"));
      await db.insert(userRoles).values({ userId: fx.actors.pmA2.userId, roleId: r.id });
      return (await loadActor(db, fx.actors.pmA2.userId))!;
    })();
    const po = await createPo(db, fx.actors.proc, poInput("1500", "40")); // AED 60,000
    await submitPo(db, fx.actors.proc, po.id);
    await approve(db, po.id, both);
    expect((await myPendingApprovals(db, both)).find((p) => p.docId === po.id)).toBeUndefined();
    const req = (await myPendingApprovals(db, fx.actors.ops)).find((p) => p.docId === po.id)!;
    await expect(db.transaction((tx) => decide(tx, both, req.requestId, "approve", undefined))).rejects.toMatchObject({ status: 403 });
  });

  it("rejection requires a reason, and the rejected document can be revised and resubmitted", async () => {
    const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "5", costCodeId: fx.costCodeId }] });
    await submitMr(db, fx.actors.engineerA, mr.id);
    const req = (await myPendingApprovals(db, fx.actors.pmA)).find((p) => p.docId === mr.id)!;
    await expect(db.transaction((tx) => decide(tx, fx.actors.pmA, req.requestId, "reject", "  "))).rejects.toMatchObject({ code: "REJECTION_REASON_REQUIRED" });
    await db.transaction((tx) => decide(tx, fx.actors.pmA, req.requestId, "reject", "Quantity too high"));
    expect((await getMr(db, fx.actors.pmA, mr.id)).status).toBe("rejected");
    const revised = await reviseMr(db, fx.actors.engineerA, mr.id);
    expect(revised.revision).toBe(1);
    await updateMr(db, fx.actors.engineerA, mr.id, { requiredDate: "2026-12-01", version: revised.version, lines: [{ itemId: fx.board.id, qty: "3", costCodeId: fx.costCodeId }] });
    await submitMr(db, fx.actors.engineerA, mr.id);
    await approve(db, mr.id, fx.actors.pmA);
    const d = await getMr(db, fx.actors.pmA, mr.id);
    expect(d.status).toBe("approved");
    expect(d.approvals.map((a) => [a.docRevision, a.status])).toEqual([[1, "approved"], [0, "rejected"]]);
  });

  it("revising an approved PO invalidates its approval; it must be approved again", async () => {
    const po = await createPo(db, fx.actors.proc, poInput("10", "10"));
    await submitPo(db, fx.actors.proc, po.id);
    await approve(db, po.id, fx.actors.pmA);
    const revised = await revisePo(db, fx.actors.proc, po.id, "Supplier changed price");
    expect(revised.status).toBe("draft");
    await updatePo(db, fx.actors.proc, po.id, { ...poInput("10", "12"), version: revised.version });
    await submitPo(db, fx.actors.proc, po.id);
    const d = await getPo(db, fx.actors.proc, po.id);
    expect(d.status).toBe("pending_approval");
    expect(d.approvals.map((a) => [a.docRevision, a.status])).toEqual([[1, "pending"], [0, "superseded"]]);
  });

  it("stale edits are refused (optimistic concurrency)", async () => {
    const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "5", costCodeId: fx.costCodeId }] });
    const edit = { requiredDate: "2026-12-02", lines: [{ itemId: fx.board.id, qty: "6", costCodeId: fx.costCodeId }] };
    await updateMr(db, fx.actors.engineerA, mr.id, { ...edit, version: mr.version });
    await expect(updateMr(db, fx.actors.engineerA, mr.id, { ...edit, version: mr.version })).rejects.toMatchObject({ status: 409 });
  });
});
