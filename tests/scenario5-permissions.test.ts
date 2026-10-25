/**
 * Acceptance scenario 5 (Phase 1 scope): a user assigned only to Project A cannot read or export
 * Project B records via lists, direct URLs, reports or exports; roles without price access never
 * receive prices from the API. Exercised through the real HTTP API.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DB } from "../server/db/client.js";
import { buildApp, CSRF_HEADER } from "../server/app.js";
import { approve, fixtures, freshDb, opening, PASSWORD, type Fx } from "./helpers.js";
import { createMr, getMr, submitMr } from "../server/services/materialRequests.js";
import { createPo, submitPo } from "../server/services/purchasing.js";

let db: DB;
let fx: Fx;
let app: FastifyInstance;
let mrB: string;
let poB: string;
let poA: string;

async function loginAs(email: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: { [CSRF_HEADER]: "1" }, payload: { email, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "edge_session")!;
  expect(cookie.httpOnly).toBe(true);
  return (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { cookie: `edge_session=${cookie.value}`, [CSRF_HEADER]: "1" } });
}

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  app = await buildApp(db, { sessionTtlHours: 1, cookieSecure: false, loginRateLimit: 1000 });
  await opening(db, fx, fx.board.id, fx.whA.id, "100");
  const mk = async (project: string, eng: typeof fx.actors.engineerA, pm: typeof fx.actors.pmA) => {
    const mr = await createMr(db, eng, { projectId: project, requiredDate: "2026-12-01", lines: [{ itemId: fx.board.id, qty: "10", costCodeId: fx.costCodeId }] });
    await submitMr(db, eng, mr.id);
    await approve(db, mr.id, pm);
    const line = (await getMr(db, pm, mr.id)).lines[0].id;
    const po = await createPo(db, fx.actors.proc, {
      projectId: project, supplierId: fx.supplier.id, deliveryLocationId: fx.whA.id,
      lines: [{ itemId: fx.board.id, mrLineId: line, costCodeId: fx.costCodeId, unitCode: "pcs", qty: "10", unitPrice: "33.5", vatCode: "SR" }],
    });
    await submitPo(db, fx.actors.proc, po.id);
    return { mr: mr.id, po: po.id };
  };
  const a = await mk(fx.projA.id, fx.actors.engineerA, fx.actors.pmA);
  const b = await mk(fx.projB.id, fx.actors.engineerB, fx.actors.pmB);
  mrB = b.mr; poB = b.po; poA = a.po;
});

afterAll(async () => { await app.close(); });

describe("Scenario 5 — project isolation and restricted fields", () => {
  it("rejects requests without a session or without the CSRF header", async () => {
    expect((await app.inject({ method: "GET", url: "/api/material-requests" })).statusCode).toBe(401);
    const noCsrf = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pm.a@test.local", password: PASSWORD } });
    expect(noCsrf.statusCode).toBe(403);
  });

  it("wrong passwords are refused and eventually lock the account", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: { [CSRF_HEADER]: "1" }, payload: { email: "engineer.b@test.local", password: "wrong" } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/api/auth/login", headers: { [CSRF_HEADER]: "1" }, payload: { email: "engineer.b@test.local", password: PASSWORD } });
    expect(locked.json().error.code).toBe("LOCKED");
  });

  it("Project A user cannot list, open, report on or export Project B", async () => {
    const as = await loginAs("engineer.a@test.local");
    const list = (await as("GET", "/api/material-requests")).json() as { projectId: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.projectId === fx.projA.id)).toBe(true);
    expect((await as("GET", `/api/material-requests?projectId=${fx.projB.id}`)).statusCode).toBe(404);
    expect((await as("GET", `/api/material-requests/${mrB}`)).statusCode).toBe(404);
    expect((await as("GET", `/api/purchase-orders/${poB}`)).statusCode).toBe(404);
    expect((await as("GET", `/api/projects/${fx.projB.id}`)).statusCode).toBe(404);
    expect((await as("GET", `/api/reports/projects/${fx.projB.id}`)).statusCode).toBe(404);
    expect((await as("GET", `/api/history/purchase_order/${poB}`)).statusCode).toBe(404);
    expect((await as("GET", `/api/stock?projectId=${fx.projB.id}`)).statusCode).toBe(404);
    const ref = (await as("GET", "/api/reference")).json() as { projects: { id: string }[]; locations: { code: string }[] };
    expect(ref.projects.map((p) => p.id)).toEqual([fx.projA.id]);
    expect(ref.locations.map((l) => l.code)).not.toContain("SS-B");
    const pm = await loginAs("pm.a@test.local");
    expect((await pm("GET", `/api/reports/projects/${fx.projB.id}/export?metric=committed`)).statusCode).toBe(404);
    // approving another project's PO through the API is impossible as well
    const approvals = (await (await loginAs("pm.b@test.local"))("GET", "/api/approvals/mine")).json() as { requestId: string; docId: string }[];
    const reqB = approvals.find((x) => x.docId === poB)!;
    expect((await pm("POST", `/api/approvals/${reqB.requestId}/decide`, { decision: "approve" })).statusCode).toBe(404);
  });

  it("site engineer and foreman never receive supplier prices or costs", async () => {
    for (const email of ["engineer.a@test.local", "foreman.a@test.local"]) {
      const as = await loginAs(email);
      const res = await as("GET", `/api/purchase-orders/${poA}`);
      if (email.startsWith("foreman")) { expect(res.statusCode).toBe(403); continue; } // foreman has no PO access at all
      const po = res.json();
      expect(po.pricesVisible).toBe(false);
      expect(po.total).toBeNull();
      expect(po.lines[0].unitPrice).toBeNull();
      expect(JSON.stringify(po)).not.toContain("33.5");
      const report = await as("GET", `/api/reports/projects/${fx.projA.id}`);
      expect(report.statusCode).toBe(200);
      expect(report.json().summary.committed).toBeNull();
      expect((await as("GET", `/api/reports/projects/${fx.projA.id}/drill?metric=committed`)).statusCode).toBe(403);
    }
    const pm = await loginAs("pm.a@test.local");
    const po = (await pm("GET", `/api/purchase-orders/${poA}`)).json();
    expect(po.lines[0].unitPrice).toBe("33.5000");
  });

  it("a foreman cannot approve, order or post stock", async () => {
    const as = await loginAs("foreman.a@test.local");
    expect((await as("POST", "/api/purchase-orders", {})).statusCode).toBe(400); // validation runs first…
    const body = { projectId: fx.projA.id, supplierId: fx.supplier.id, deliveryLocationId: fx.ssA.id, lines: [{ itemId: fx.board.id, costCodeId: fx.costCodeId, unitCode: "pcs", qty: "1", unitPrice: "1", vatCode: "SR" }] };
    expect((await as("POST", "/api/purchase-orders", body)).statusCode).toBe(403); // …then permission
    expect((await as("POST", "/api/stock-issues", { idempotencyKey: "foreman-issue-1", locationId: fx.ssA.id, issuedTo: "x", lines: [{ mrLineId: fx.board.id, qty: "1" }] })).statusCode).toBe(403);
  });

  it("login is rate limited per IP", async () => {
    const strict = await buildApp(db, { sessionTtlHours: 1, cookieSecure: false, loginRateLimit: 3 });
    const codes = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await strict.inject({ method: "POST", url: "/api/auth/login", headers: { [CSRF_HEADER]: "1" }, payload: { email: "nobody@test.local", password: "x" } })).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429]);
    await strict.close();
  });

  it("CSV exports neutralise spreadsheet formulas", async () => {
    const { toCsv } = await import("../server/lib/csv.js");
    const csv = toCsv([{ a: "=HYPERLINK(\"http://x\")", b: "-12.50", c: "@SUM(1)", d: "plain, text" }], [
      { key: "a", header: "A" }, { key: "b", header: "B" }, { key: "c", header: "C" }, { key: "d", header: "D" }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(",-12.50,");
    expect(csv).toContain("'@SUM(1)");
    expect(csv).toContain('"plain, text"');
  });
});
