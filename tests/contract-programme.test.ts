/** Contract register, contract BOQ, site measurements, cost budget, P6 programme baseline and activity progress. */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../server/db/client.js";
import { boqLines, contracts, costCodes, projectMembers, roles, userRoles, users } from "../server/db/schema.js";
import { loadActor, type Actor } from "../server/auth/actor.js";
import { hashPassword } from "../server/auth/sessions.js";
import { addDays, businessToday } from "../server/lib/dates.js";
import { dec } from "../server/lib/decimal.js";
import { parseBoqCsv } from "../server/lib/boqParse.js";
import { parseFlexDate, parseProgrammeCsv, parseProgressCsv, parseXer } from "../server/lib/p6.js";
import { plannedPct, plannedProjectPct, scheduleVarianceDays, weightedPct, type PlanActivity } from "../server/lib/programme.js";
import * as ct from "../server/services/contracts.js";
import * as prg from "../server/services/programme.js";
import { overview } from "../server/services/overview.js";
import { fixtures, freshDb, type Fx } from "./helpers.js";

let db: DB;
let fx: Fx;
let qs: Actor;
let planner: Actor;
const today = businessToday();
const d = (n: number) => addDays(today, n);

const BOQ = `Ref,Description,Unit,Quantity,Rate,Amount,Cost code
B1,BILL 1 - SUBSTRUCTURE,,,,,
1.01,Excavation for foundations,m3,"1,200",45.00,"54,000.00",
1.02,Blinding concrete 50mm,m2,800,32.5,26000,04-220
B2,BILL 2 - FINISHES,,,,,
2.01,Porcelain floor tiles 600x600,m2,1500,95,142500,09-300
2.02,Gypsum partitions,m2,2000,110,220000,09-210
2.03,Preliminaries,LS,,,57500,
PS1,Provisional sum for client signage,PS,,,50000,
`;
// 54,000 + 26,000 + 142,500 + 220,000 + 57,500 + 50,000 = 550,000

const XER = [
  "ERMHDR\t21.12\t2026-09-01\tProject\tadmin\tdemo\tdbxDatabaseNoName\tProject Management\tAED",
  "%T\tPROJECT", "%F\tproj_id\tproj_short_name\tlast_recalc_date", "%R\t101\tT-A-BL0\t2026-09-01 08:00",
  "%T\tPROJWBS", "%F\twbs_id\tproj_id\tparent_wbs_id\twbs_short_name\twbs_name\tproj_node_flag",
  "%R\t1\t101\t\tT-A\tProject A\tY", "%R\t2\t101\t1\tSUB\tSubstructure\tN", "%R\t3\t101\t2\tEXC\tExcavation\tN", "%R\t4\t101\t1\tFIN\tFinishes\tN",
  "%T\tTASK", "%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_start_date\ttarget_end_date\ttarget_drtn_hr_cnt",
  "%R\t11\t101\t1\tM000\tStart of works\tTT_Mile\t2026-09-01 08:00\t2026-09-01 08:00\t0",
  "%R\t12\t101\t3\tA1000\tExcavation\tTT_Task\t2026-09-01 08:00\t2026-09-10 17:00\t80",
  "%R\t13\t101\t4\tA2000\tTiling\tTT_Task\t2026-09-11 08:00\t2026-09-30 17:00\t160",
  "%R\t14\t101\t1\tLOE1\tSite management\tTT_LOE\t2026-09-01 08:00\t2026-09-30 17:00\t240",
  "%E",
].join("\r\n");

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  const pw = await hashPassword("Test@Password1");
  const mk = async (email: string, role: string) => {
    const [u] = await db.insert(users).values({ email, fullName: email.split("@")[0], passwordHash: pw }).returning();
    const [r] = await db.select().from(roles).where(eq(roles.key, role));
    await db.insert(userRoles).values({ userId: u.id, roleId: r.id });
    await db.insert(projectMembers).values({ userId: u.id, projectId: fx.projA.id });
    return (await loadActor(db, u.id)) as Actor;
  };
  qs = await mk("qs.a@test.local", "quantity_surveyor");
  planner = await mk("planner.a@test.local", "planning_engineer");
});

describe("reading files", () => {
  it("reads P6 and Excel date formats", () => {
    expect(parseFlexDate("01-Sep-26")).toBe("2026-09-01");
    expect(parseFlexDate("01-Sep-2026 08:00 A")).toBe("2026-09-01");
    expect(parseFlexDate("2026-09-01 08:00")).toBe("2026-09-01");
    expect(parseFlexDate("31/10/2026")).toBe("2026-10-31");
    expect(parseFlexDate("31-Feb-26")).toBeNull();
  });

  it("reads a BOQ: headings, items, lump sums, provisional sums and their sections", () => {
    const r = parseBoqCsv(BOQ);
    expect(r.problems).toEqual([]);
    expect(r.total).toBe("550000.00");
    expect(r.lines.map((l) => l.kind)).toEqual(["heading", "item", "item", "heading", "item", "item", "item", "provisional_sum"]);
    expect(r.lines[1]).toMatchObject({ ref: "1.01", qty: "1200.0000", amount: "54000.00", section: "BILL 1 - SUBSTRUCTURE" });
    expect(r.lines[6]).toMatchObject({ ref: "2.03", qty: "1.0000", rate: "57500.0000", section: "BILL 2 - FINISHES" });
  });

  it("lists BOQ problems with row numbers", () => {
    const r = parseBoqCsv("Ref,Description,Unit,Quantity,Rate,Amount\n1,Wall,m2,10,5,999\n2,,m2,1,1,1\n3,Door,nr,abc,1,\n4,Window,,2,3,6\n");
    expect(r.problems).toEqual([
      "Row 2 (1): amount 999.00 is not quantity × rate (10.0000 × 5 = 50.00).",
      "Row 3 (2): description is empty.",
      "Row 4 (3): quantity, rate and amount must be numbers.",
      "Row 5 (4): unit is empty.",
    ]);
  });

  it("reads a P6 XER export: planned dates, WBS path, milestones, and skips level-of-effort", () => {
    const r = parseXer(XER);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ projectCode: "T-A-BL0", dataDate: "2026-09-01", skipped: 1 });
    expect(r.activities.map((a) => a.code)).toEqual(["M000", "A1000", "A2000"]);
    expect(r.activities[1]).toMatchObject({ wbsCode: "SUB.EXC", wbsName: "Substructure › Excavation", plannedStart: "2026-09-01", plannedFinish: "2026-09-10", durationDays: 10, weight: "80" });
    expect(r.activities[0]).toMatchObject({ isMilestone: true, weight: "0" });
  });

  it("rejects an XER with several projects and a CSV without activity IDs", () => {
    const two = XER.replace("%R\t13\t101", "%R\t13\t202");
    expect(parseXer(two).problems[0]).toMatch(/2 projects/);
    expect(parseProgrammeCsv("Name,Start\nX,01/09/2026\n").problems[0]).toMatch(/Activity ID/);
  });

  it("reads P6's Excel export column names and the site progress sheet", () => {
    const r = parseProgrammeCsv("Activity ID,Activity Name,Original Duration,Start,Finish,Activity Type\nA1,Walls,10d,01-Sep-26,10-Sep-26,Task Dependent\nM1,Handover,0d,30-Sep-26,30-Sep-26,Finish Milestone\n");
    expect(r.problems).toEqual([]);
    expect(r.activities[0]).toMatchObject({ code: "A1", durationDays: 10, weight: "10", isMilestone: false });
    expect(r.activities[1]).toMatchObject({ isMilestone: true });
    const p = parseProgressCsv("Activity ID,Activity % Complete,Actual Start,Actual Finish,Remarks\nA1,40%,02/09/2026,,slow\nA2,140,,,\n");
    expect(p.rows[0]).toEqual({ activityCode: "A1", pctComplete: "40", actualStart: "2026-09-02", actualFinish: null, remark: "slow" });
    expect(p.problems[0]).toMatch(/Row 3 \(A2\)/);
  });
});

describe("example files given to EDGE's team", () => {
  it("deploy/examples/*.csv read without problems", () => {
    const read = (f: string) => readFileSync(`deploy/examples/${f}`, "utf8");
    expect(parseBoqCsv(read("boq-example.csv"))).toMatchObject({ problems: [], total: "18500000.00" });
    expect(parseProgrammeCsv(read("programme-example.csv")).problems).toEqual([]);
    expect(parseProgressCsv(read("progress-example.csv"))).toMatchObject({ problems: [], rows: expect.arrayContaining([expect.objectContaining({ activityCode: "A1110", actualStart: "2026-10-02" })]) });
  });
});

describe("programme arithmetic", () => {
  const a: PlanActivity = { code: "A", plannedStart: "2026-09-01", plannedFinish: "2026-09-10", isMilestone: false, weight: "10" };
  const b: PlanActivity = { code: "B", plannedStart: "2026-09-11", plannedFinish: "2026-09-30", isMilestone: false, weight: "30" };
  it("spreads planned % evenly over each activity's days and weights the project %", () => {
    expect(plannedPct(a, "2026-08-31").toNumber()).toBe(0);
    expect(plannedPct(a, "2026-09-05").toNumber()).toBe(50);
    expect(plannedPct(a, "2026-09-10").toNumber()).toBe(100);
    expect(plannedProjectPct([a, b], "2026-09-10").toNumber()).toBe(25);
    expect(weightedPct([{ ...a, weight: "0" }, { ...b, weight: "0" }], () => dec(50)).toNumber()).toBe(50);
  });
  it("says how many days behind the plan the actual % is", () => {
    // 25% was planned for 10 Sep; on 20 Sep only 25% is done → 10 days behind.
    expect(scheduleVarianceDays([a, b], dec(25), "2026-09-20")).toBe(-10);
    expect(scheduleVarianceDays([a, b], dec(0), "2026-08-01")).toBeNull();
  });
});

describe("contract and BOQ", () => {
  it("only commercial roles see or edit the contract", async () => {
    await expect(ct.getContract(db, fx.actors.engineerA, fx.projA.id)).rejects.toMatchObject({ status: 403 });
    await expect(ct.saveContract(db, fx.actors.pmB, fx.projA.id, { contractNo: "X", contractValue: "1", retentionPct: "0", advancePct: "0" })).rejects.toMatchObject({ status: 404 });
  });

  it("records the contract and keeps the project card in step", async () => {
    const c = await ct.saveContract(db, qs, fx.projA.id, {
      contractNo: "CT-A-001", form: "FIDIC 1999 Red Book (amended)", commencementDate: d(-60), completionDate: d(300), contractValue: "550000",
      retentionPct: "10", retentionLimitPct: "5", advancePct: "10", ldPerDay: "2500", ldCapPct: "10", defectsLiabilityMonths: 12, paymentTermsDays: 30,
    });
    expect(c).toMatchObject({ contractValue: "550000.00", retentionPct: "10.00", boqStatus: "none", version: 1 });
    const view = await ct.getContract(db, fx.actors.pmA, fx.projA.id);
    const completion = d(300);
    expect(view.contract).toMatchObject({ durationDays: 361 });
    if (!completion.endsWith("02-29")) expect(view.contract!.dlpEndDate).toBe(`${Number(completion.slice(0, 4)) + 1}${completion.slice(4)}`);
    await expect(ct.saveContract(db, qs, fx.projA.id, { contractNo: "CT-A-001", contractValue: "550000", retentionPct: "10", advancePct: "10", version: 7 })).rejects.toMatchObject({ status: 409 });
  });

  it("warns about guarantees and insurances that are about to expire", async () => {
    await ct.addSecurity(db, qs, fx.projA.id, { kind: "performance_bond", reference: "PB-1", issuer: "Demo Bank", amount: "55000", expiryDate: d(20) });
    await ct.addSecurity(db, qs, fx.projA.id, { kind: "car_insurance", reference: "CAR-1", expiryDate: d(200) });
    const v = await ct.getContract(db, qs, fx.projA.id);
    expect(v.securities.map((s) => [s.reference, s.state])).toEqual([["PB-1", "expiring"], ["CAR-1", "valid"]]);
  });

  it("imports the BOQ: nothing is saved when a row is wrong; a dry run saves nothing either", async () => {
    const bad = await ct.importBoq(db, qs, fx.projA.id, { csv: BOQ.replace("04-220", "99-999") });
    expect(bad).toMatchObject({ ok: false, saved: false });
    expect(bad.problems[0]).toMatch(/cost code "99-999"/);
    const dry = await ct.importBoq(db, qs, fx.projA.id, { csv: BOQ, dryRun: true });
    expect(dry).toMatchObject({ ok: true, saved: false, total: "550000.00", difference: "0.00" });
    expect(await db.select().from(boqLines)).toHaveLength(0);
  });

  it("a draft BOQ can be re-imported; confirming needs the total to match or an explanation", async () => {
    await ct.importBoq(db, qs, fx.projA.id, { csv: BOQ.replace("57500", "60000"), fileName: "boq-v1.csv" });
    const r = await ct.importBoq(db, qs, fx.projA.id, { csv: BOQ.replace("57500", "57000"), fileName: "boq-v2.csv" });
    expect(r).toMatchObject({ saved: true, lines: 8, total: "549500.00", difference: "-500.00" });
    await expect(ct.confirmBoq(db, qs, fx.projA.id, {})).rejects.toMatchObject({ code: "BOQ_TOTAL_MISMATCH" });
    await ct.confirmBoq(db, qs, fx.projA.id, { note: "AED 500 rounding discount agreed at signing" });
    const v = await ct.getContract(db, fx.actors.pmA, fx.projA.id);
    expect(v.boq).toMatchObject({ status: "confirmed", total: "549500.00", provisionalSums: "50000.00", confirmNote: "AED 500 rounding discount agreed at signing" });
    expect(v.contract!.boqConfirmedByName).toBe("qs.a");
  });

  it("a confirmed BOQ is frozen, in the service and in the database", async () => {
    await expect(ct.importBoq(db, qs, fx.projA.id, { csv: BOQ })).rejects.toMatchObject({ code: "BOQ_CONFIRMED" });
    await expect(db.update(boqLines).set({ rate: "1" }).where(eq(boqLines.ref, "2.01"))).rejects.toThrow();
    await expect(db.delete(boqLines).where(eq(boqLines.ref, "2.01"))).rejects.toThrow();
    await expect(db.update(contracts).set({ boqStatus: "draft" }).where(eq(contracts.projectId, fx.projA.id))).rejects.toThrow();
  });

  it("site measures quantities to date; rates and values are hidden from the site engineer", async () => {
    const boq = await ct.getBoq(db, fx.actors.engineerA, fx.projA.id);
    const tiles = boq.lines.find((l) => l.ref === "2.01")!;
    const exc = boq.lines.find((l) => l.ref === "1.01")!;
    expect(tiles).toMatchObject({ rate: null, amount: null, valueDone: null });
    expect(boq.summary).toBeNull();
    const r = await ct.recordMeasurements(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(-1), rows: [{ boqLineId: tiles.id, qtyToDate: "600" }, { boqLineId: exc.id, qtyToDate: "1300" }] });
    expect(r).toMatchObject({ ok: true, saved: 2 });
    expect(r.warnings[0]).toMatch(/more than the BOQ quantity/);
    // Going down needs a reason; unchanged rows are skipped.
    const down = await ct.recordMeasurements(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(0), rows: [{ boqLineId: exc.id, qtyToDate: "1200" }, { boqLineId: tiles.id, qtyToDate: "600" }] });
    expect(down.problems[0]).toMatch(/lower than last time/);
    expect((await ct.recordMeasurements(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(0), rows: [{ boqLineId: exc.id, qtyToDate: "1200", remark: "Remeasured with surveyor" }, { boqLineId: tiles.id, qtyToDate: "600" }] })).saved).toBe(1);
    const qsView = await ct.getBoq(db, qs, fx.projA.id);
    expect(qsView.lines.find((l) => l.ref === "2.01")).toMatchObject({ qtyToDate: "600.0000", pctDone: "40.0", valueDone: "57000.00" });
    // 1,200 × 45 + 600 × 95 = 111,000 of 549,500
    expect(qsView.summary).toMatchObject({ workDone: "111000.00", workDonePct: "20.2" });
    expect(await ct.measurementHistory(db, qs, exc.id)).toHaveLength(2);
    await expect(ct.recordMeasurements(db, fx.actors.engineerB, fx.projA.id, { asOfDate: d(0), rows: [{ boqLineId: exc.id, qtyToDate: "1" }] })).rejects.toMatchObject({ status: 404 });
  });

  it("compares the cost budget with purchase commitments; budgets need cost permission", async () => {
    const [tiling] = await db.select().from(costCodes).where(eq(costCodes.code, "09-300"));
    const b = await ct.setBudget(db, qs, fx.projA.id, [{ costCodeId: tiling.id, amount: "100000", note: "Tiles supply" }]);
    expect(b.rows.find((r) => r.costCode === "09-300")).toMatchObject({ budget: "100000.00", committed: "0.00", remaining: "100000.00" });
    await expect(ct.getBudget(db, fx.actors.engineerA, fx.projA.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("programme baseline and progress on site", () => {
  it("a site engineer cannot import the baseline; the planner can, after checking it", async () => {
    await expect(prg.importBaseline(db, fx.actors.engineerA, fx.projA.id, { format: "xer", text: XER, name: "BL0" })).rejects.toMatchObject({ status: 403 });
    const dry = await prg.importBaseline(db, planner, fx.projA.id, { format: "xer", text: XER, name: "Baseline rev 0", dryRun: true });
    expect(dry).toMatchObject({ ok: true, saved: false, activities: 3, milestones: 1, skipped: 1, plannedStart: "2026-09-01", plannedFinish: "2026-09-30" });
  });

  it("imports the baseline and site progress feeds the % complete, the S-curve and the overview", async () => {
    // A programme that runs around today, so planned % is part-way.
    const csv = `Activity ID,Activity Name,WBS Code,Start,Finish,Activity Type
M0,Start,,${d(-30)},${d(-30)},Start Milestone
A1,Blockwork L1-L3,STR,${d(-30)},${d(-11)},Task Dependent
A2,Plaster L1-L3,FIN,${d(-10)},${d(9)},Task Dependent
A3,Tiling L1-L3,FIN,${d(10)},${d(49)},Task Dependent
`;
    const r = await prg.importBaseline(db, planner, fx.projA.id, { format: "csv", text: csv, name: "Baseline rev 0", fileName: "bl0.csv" });
    expect(r).toMatchObject({ ok: true, saved: true, activities: 4 });

    const bad = await prg.recordProgress(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(0), rows: [
      { activityCode: "A1", pctComplete: "100", actualStart: d(-30), actualFinish: null, remark: null },
      { activityCode: "ZZ9", pctComplete: "10", actualStart: d(-1), actualFinish: null, remark: null },
    ] });
    expect(bad.ok).toBe(false);
    expect(bad.problems).toEqual([expect.stringMatching(/A1 .*actual finish date/), expect.stringMatching(/ZZ9: not an activity/)]);

    const ok = await prg.recordProgress(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(-1), rows: [
      { activityCode: "A1", pctComplete: "100", actualStart: d(-30), actualFinish: d(-5), remark: null },
      { activityCode: "A2", pctComplete: "20", actualStart: d(-4), actualFinish: null, remark: "Started late, waiting for blockwork" },
      { activityCode: "A3", pctComplete: "0", actualStart: null, actualFinish: null, remark: null },
    ] });
    expect(ok).toMatchObject({ ok: true, saved: 2 });

    const p = await prg.getProgramme(db, fx.actors.engineerA, fx.projA.id);
    // Weights 20, 20, 40 days. Planned today: A1 100%, A2 11/20 = 55% → (20 + 11) / 80 = 38.75%. Actual: (20 + 4) / 80 = 30%.
    expect(p.summary).toMatchObject({ plannedPct: 38.8, actualPct: 30, variancePct: -8.8 });
    expect(p.summary!.daysAheadBehind).toBe(-7);
    expect(p.activities.find((a) => a.code === "A2")).toMatchObject({ state: "in_progress", pct: 20, behind: true, inShortLookAhead: true });
    expect(p.curve.at(-1)).toMatchObject({ actual: null });
    expect(p.curve.find((x) => x.date === today)).toMatchObject({ planned: 38.8, actual: 30 });

    const o = await overview(db, fx.actors.pmA);
    const row = o.projects.find((x) => x.project.id === fx.projA.id)!;
    expect(row.programme).toMatchObject({ source: "baseline", plannedPct: "38.75", actualPct: "30.00", daysAheadBehind: -7, rag: "amber" });
    expect(row.money).toMatchObject({ contractValue: "550000.00", workDone: "111000.00" });
    expect(row.attention).toEqual(expect.arrayContaining([expect.stringMatching(/guarantee\/insurance expiring/)]));
  });

  it("keeps history, skips unchanged rows, refuses back-dating and carries progress to a new baseline", async () => {
    const again = await prg.recordProgress(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(0), rows: [{ activityCode: "A2", pctComplete: "20", actualStart: d(-4), actualFinish: null, remark: null }] });
    expect(again).toMatchObject({ ok: true, saved: 0, unchanged: 1 });
    const back = await prg.recordProgress(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(-3), rows: [{ activityCode: "A2", pctComplete: "25", actualStart: d(-4), actualFinish: null, remark: null }] });
    expect(back.problems[0]).toMatch(/already recorded/);
    await expect(db.execute(sql`update activity_progress set pct_complete = 99`)).rejects.toThrow();

    const sheet = await prg.progressSheetCsv(db, fx.actors.engineerA, fx.projA.id);
    expect(sheet.csv).toMatch(/activity_id,activity_name/);
    const imported = await prg.importProgressCsv(db, fx.actors.engineerA, fx.projA.id, { asOfDate: d(0), csv: sheet.csv.replace(/(\r\nA2,Plaster L1-L3,FIN,,[^,]+,[^,]+,)20,/, (_m, head: string) => `${head}35,`) });
    expect(imported).toMatchObject({ ok: true, saved: 1 });
    expect(await prg.activityHistory(db, fx.actors.pmA, fx.projA.id, "A2")).toHaveLength(2);

    const rebase = `Activity ID,Activity Name,Start,Finish\nA2,Plaster L1-L3,${d(-10)},${d(20)}\nA3,Tiling L1-L3,${d(21)},${d(60)}\n`;
    const r = await prg.importBaseline(db, fx.actors.pmA, fx.projA.id, { format: "csv", text: rebase, name: "Revised programme (EOT 1)" });
    expect(r.warnings[0]).toMatch(/1 activity ID\(s\) with recorded progress are not in this file \(A1\)/);
    const p = await prg.getProgramme(db, fx.actors.pmA, fx.projA.id);
    expect(p.baselines.map((b) => [b.name, b.isCurrent])).toEqual([["Revised programme (EOT 1)", true], ["Baseline rev 0", false]]);
    expect(p.activities.find((a) => a.code === "A2")).toMatchObject({ pct: 35 });
  });

  it("other projects' programmes stay out of reach", async () => {
    await expect(prg.getProgramme(db, fx.actors.engineerB, fx.projA.id)).rejects.toMatchObject({ status: 404 });
    await expect(prg.recordProgress(db, fx.actors.engineerB, fx.projA.id, { asOfDate: d(0), rows: [] })).rejects.toMatchObject({ status: 404 });
  });
});
