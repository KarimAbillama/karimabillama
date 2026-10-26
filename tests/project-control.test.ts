/** Project control: submittals (samples, mock-ups), daily site reports, progress and the owner's overview. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../server/db/client.js";
import { companies, projectMembers, projects, roles, submittalCodes, userRoles, users } from "../server/db/schema.js";
import { loadActor, type Actor } from "../server/auth/actor.js";
import { hashPassword } from "../server/auth/sessions.js";
import { addDays, businessToday } from "../server/lib/dates.js";
import { lastWorkday } from "../server/lib/workdays.js";
import * as sub from "../server/services/submittals.js";
import * as sr from "../server/services/siteReports.js";
import { addProgressUpdate, overview } from "../server/services/overview.js";
import { createMr, getMr, submitMr } from "../server/services/materialRequests.js";
import { createPo, submitPo } from "../server/services/purchasing.js";
import { dashboard } from "../server/services/reports.js";
import { approve, fixtures, freshDb, PASSWORD, type Fx } from "./helpers.js";

let db: DB;
let fx: Fx;
let docA: Actor; // document controller on project A
let codes: Record<string, string>; // code → id on project A
let consultantId: string;
const today = businessToday();

beforeAll(async () => {
  db = await freshDb();
  fx = await fixtures(db);
  const [consultant] = await db.insert(companies).values({ code: "CN-T", name: "Test Consultant", isConsultant: true }).returning();
  consultantId = consultant.id;
  await db.update(projects).set({ consultantCompanyId: consultant.id, submittalReviewDays: 14 }).where(eq(projects.id, fx.projA.id));
  const [role] = await db.select().from(roles).where(eq(roles.key, "document_controller"));
  const [u] = await db.insert(users).values({ email: "dc.a@test.local", fullName: "Doc Controller A", passwordHash: await hashPassword(PASSWORD) }).returning();
  await db.insert(userRoles).values({ userId: u.id, roleId: role.id });
  await db.insert(projectMembers).values({ userId: u.id, projectId: fx.projA.id });
  docA = (await loadActor(db, u.id))!;
  const set = await sub.setCodes(db, fx.actors.pmA, fx.projA.id, [
    { code: "A", label: "Approved", outcome: "approved" },
    { code: "B", label: "Approved as noted", outcome: "approved_as_noted" },
    { code: "C", label: "Revise and resubmit", outcome: "revise_resubmit" },
    { code: "D", label: "Rejected", outcome: "rejected" },
  ]);
  codes = Object.fromEntries(set.map((c) => [c.code, c.id]));
});

const newSubmittal = (extra: Partial<sub.SubmittalInput> = {}) => sub.createSubmittal(db, docA, {
  projectId: fx.projA.id, type: "sample", title: "Porcelain tile sample", discipline: "architectural", ...extra,
});

describe("submittals, samples and mock-ups", () => {
  it("runs draft → with consultant → revise & resubmit → resubmitted → approved, keeping every revision", async () => {
    const s = await newSubmittal({ requiredBy: addDays(today, 20) });
    expect(s.number).toMatch(/^SUB-\d{4}-\d{5}$/);
    expect(s.consultantId).toBe(consultantId); // taken from the project
    const sent = await sub.submitToConsultant(db, docA, s.id, { submittedDate: addDays(today, -10), transmittalRef: "TR-001" });
    expect(sent).toEqual({ revNo: 0, dueDate: addDays(today, 4) });
    let d = await sub.getSubmittal(db, fx.actors.engineerA, s.id);
    expect(d).toMatchObject({ status: "with_consultant", ballInCourt: "consultant", daysWithConsultant: 10, overdue: false });

    // A "revise" response needs the consultant's comments.
    await expect(sub.recordResponse(db, docA, s.id, { codeId: codes.C, returnedDate: addDays(today, -5) })).rejects.toMatchObject({ code: "COMMENTS_REQUIRED" });
    await sub.recordResponse(db, docA, s.id, { codeId: codes.C, returnedDate: addDays(today, -5), consultantComments: "Provide a darker grout sample" });
    d = await sub.getSubmittal(db, docA, s.id);
    expect(d).toMatchObject({ status: "revise_resubmit", ballInCourt: "edge" });

    // A resubmission cannot be dated before the response it answers.
    await expect(sub.submitToConsultant(db, docA, s.id, { submittedDate: addDays(today, -6) })).rejects.toMatchObject({ code: "DATE_ORDER" });
    await sub.submitToConsultant(db, docA, s.id, { submittedDate: addDays(today, -3) });
    await sub.recordResponse(db, docA, s.id, { codeId: codes.B, returnedDate: today, consultantComments: "Approved as noted" });
    d = await sub.getSubmittal(db, docA, s.id);
    expect(d.status).toBe("approved");
    expect(d.currentRevision).toBe(1);
    expect(d.revisions.map((r) => [r.revNo, r.code])).toEqual([[1, "B"], [0, "C"]]);
    expect(d.ballInCourt).toBeNull();
  });

  it("flags a submittal overdue with the consultant and puts it on the document controller's dashboard", async () => {
    const s = await newSubmittal({ type: "shop_drawing", title: "Chiller plant room shop drawing", discipline: "mechanical" });
    await sub.submitToConsultant(db, docA, s.id, { submittedDate: addDays(today, -20) }); // due 14 days later → 6 days overdue
    const d = await sub.getSubmittal(db, docA, s.id);
    expect(d).toMatchObject({ overdue: true, daysOverdue: 6 });
    const dash = await dashboard(db, docA);
    expect(dash.actions.find((a) => a.kind === "submittal_overdue" && a.title.startsWith(s.number))).toMatchObject({ overdue: true, owner: "Document controller" });
    expect((await sub.listSubmittals(db, docA, { ball: "consultant", overdue: true })).map((x) => x.id)).toContain(s.id);
  });

  it("a recorded consultant response cannot be edited or deleted", async () => {
    const s = await newSubmittal({ type: "mockup", title: "Bathroom mock-up, type B", discipline: "architectural" });
    await sub.submitToConsultant(db, docA, s.id, { submittedDate: today });
    await sub.recordResponse(db, docA, s.id, { codeId: codes.A, returnedDate: today, inspectionDate: today, reviewerName: "Consultant RE" });
    await expect(db.execute(sql`update submittal_revisions set outcome = 'rejected' where submittal_id = ${s.id}`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/cannot be changed/) } });
    await expect(db.execute(sql`delete from submittal_revisions where submittal_id = ${s.id}`)).rejects.toThrow();
  });

  it("only uses this project's codes, and codes already used cannot change meaning", async () => {
    const s = await newSubmittal();
    await sub.submitToConsultant(db, docA, s.id, { submittedDate: today });
    await sub.setCodes(db, fx.actors.pmB, fx.projB.id, [{ code: "1", label: "No objection", outcome: "approved" }]);
    const [codeB] = await db.select().from(submittalCodes).where(eq(submittalCodes.projectId, fx.projB.id));
    await expect(sub.recordResponse(db, docA, s.id, { codeId: codeB.id, returnedDate: today })).rejects.toMatchObject({ code: "UNKNOWN_CODE" });
    await expect(sub.setCodes(db, fx.actors.pmA, fx.projA.id, [{ code: "A", label: "Approved", outcome: "approved" }])).rejects.toMatchObject({ code: "CODE_IN_USE" });
  });

  it("is scoped to the project: outsiders get 404 and site engineers cannot manage", async () => {
    const s = await newSubmittal();
    await expect(sub.getSubmittal(db, fx.actors.engineerB, s.id)).rejects.toMatchObject({ status: 404 });
    await expect(sub.submitToConsultant(db, fx.actors.engineerA, s.id, { submittedDate: today })).rejects.toMatchObject({ status: 403 });
    expect((await sub.listSubmittals(db, fx.actors.pmB, {})).some((x) => x.projectId === fx.projA.id)).toBe(false);
  });

  it("blocks a purchase order for an item whose submittal is not yet approved, then allows it", async () => {
    const mr = await createMr(db, fx.actors.engineerA, { projectId: fx.projA.id, requiredDate: addDays(today, 10), lines: [{ itemId: fx.tile.id, qty: "100", costCodeId: fx.costCodeId }] });
    await submitMr(db, fx.actors.engineerA, mr.id);
    await approve(db, mr.id, fx.actors.pmA);
    const line = (await getMr(db, fx.actors.pmA, mr.id)).lines[0];
    const s = await newSubmittal({ type: "material", title: "Floor tile material submittal", itemIds: [fx.tile.id] });
    await sub.submitToConsultant(db, docA, s.id, { submittedDate: today });
    const po = await createPo(db, fx.actors.proc, {
      projectId: fx.projA.id, supplierId: fx.supplier.id, deliveryLocationId: fx.ssA.id,
      lines: [{ itemId: fx.tile.id, mrLineId: line.id, costCodeId: fx.costCodeId, unitCode: "m2", qty: "100", unitPrice: "40", vatCode: "SR" }],
    });
    await expect(submitPo(db, fx.actors.proc, po.id)).rejects.toMatchObject({ code: "SUBMITTAL_NOT_APPROVED" });
    await sub.recordResponse(db, docA, s.id, { codeId: codes.A, returnedDate: today });
    await expect(submitPo(db, fx.actors.proc, po.id)).resolves.toMatchObject({ status: "pending_approval" });
  });
});

describe("daily site reports", () => {
  const report = (date: string, extra: Partial<sr.SiteReportInput> = {}) => sr.createSiteReport(db, fx.actors.engineerA, {
    projectId: fx.projA.id, siteId: fx.siteA.id, reportDate: date, workDone: "Blockwork L2 grid A–C", weather: "Clear, 34°C",
    manpower: [{ trade: "Mason", headcount: 12 }, { trade: "Helper", headcount: 8 }], ...extra,
  });

  it("allows one report per site per day, written up to 7 days late and never in the future", async () => {
    const r = await report(addDays(today, -2));
    await expect(report(addDays(today, -2))).rejects.toMatchObject({ code: "REPORT_EXISTS" });
    await expect(report(addDays(today, 1))).rejects.toMatchObject({ code: "FUTURE_DATE" });
    await expect(report(addDays(today, -8))).rejects.toMatchObject({ code: "TOO_LATE" });
    expect((await sr.getSiteReport(db, fx.actors.pmA, r.id)).totalHeadcount).toBe(20);
  });

  it("needs a description of delays and safety incidents", async () => {
    await expect(report(addDays(today, -3), { delayCause: "material" })).rejects.toMatchObject({ code: "ISSUES_REQUIRED" });
    await expect(report(addDays(today, -3), { safetyIncidents: 1 })).rejects.toMatchObject({ code: "SAFETY_NOTES_REQUIRED" });
  });

  it("is reviewed by someone other than the author; a return needs a comment and the author can fix and resubmit", async () => {
    const r = await report(addDays(today, -4), { delayCause: "material", issues: "Blocks not delivered until 11:00" });
    await sr.submitSiteReport(db, fx.actors.engineerA, r.id);
    await expect(sr.reviewSiteReport(db, fx.actors.engineerA, r.id, "accept")).rejects.toMatchObject({ status: 403 });
    await expect(sr.reviewSiteReport(db, fx.actors.pmA, r.id, "return")).rejects.toMatchObject({ code: "COMMENT_REQUIRED" });
    expect((await dashboard(db, fx.actors.pmA)).actions.some((a) => a.kind === "site_report_review" && a.link === `/site-reports/${r.id}`)).toBe(true);
    await sr.reviewSiteReport(db, fx.actors.pmA, r.id, "return", "Add the subcontractor names");
    const back = await sr.getSiteReport(db, fx.actors.engineerA, r.id);
    await sr.updateSiteReport(db, fx.actors.engineerA, r.id, { ...back, delayCause: "material", manpower: [{ trade: "Mason", headcount: 12 }], version: back.version });
    await sr.submitSiteReport(db, fx.actors.engineerA, r.id);
    await sr.reviewSiteReport(db, fx.actors.pmA, r.id, "accept");
    expect((await sr.getSiteReport(db, fx.actors.pmA, r.id)).status).toBe("reviewed");
  });

  it("reminds the site team when yesterday's report is missing, and hides other projects' reports", async () => {
    const dashB = await dashboard(db, fx.actors.engineerB);
    expect(dashB.actions.some((a) => a.kind === "site_report_missing" && a.projectCode === fx.projB.code && a.due === lastWorkday(today))).toBe(true);
    expect((await sr.listSiteReports(db, fx.actors.engineerB, {})).every((x) => x.projectId === fx.projB.id)).toBe(true);
  });
});

describe("owner's overview", () => {
  it("rates each project from progress, submittals, site reports and supply, scoped to what the viewer may see", async () => {
    await addProgressUpdate(db, fx.actors.pmA, { projectId: fx.projA.id, asOfDate: today, plannedPct: "46", actualPct: "34", summary: "Blockwork behind" });
    await expect(addProgressUpdate(db, fx.actors.engineerA, { projectId: fx.projA.id, asOfDate: today, plannedPct: "1", actualPct: "1" })).rejects.toMatchObject({ status: 403 });

    const o = await overview(db, fx.actors.director);
    const a = o.projects.find((p) => p.project.id === fx.projA.id)!;
    expect(a.programme).toMatchObject({ plannedPct: "46.00", actualPct: "34.00", rag: "red" });
    expect(a.approvals!.overdue).toBeGreaterThanOrEqual(1);
    expect(a.overall).toBe("red");
    expect(a.attention.some((t) => t.includes("overdue with the consultant"))).toBe(true);
    expect(a.money).not.toBeNull();
    expect(a.site.headcount).toBe(12); // the latest submitted report (the draft does not count)
    expect((await sr.listSiteReports(db, fx.actors.pmA, { projectId: fx.projA.id })).find((x) => x.status === "reviewed")?.headcount).toBe(12);
    expect(o.projects[0].overall).toBe("red"); // worst first

    // A project manager on project B sees only B; a site engineer sees no money.
    const ob = await overview(db, fx.actors.pmB);
    expect(ob.projects.map((p) => p.project.id)).toEqual([fx.projB.id]);
    const oe = await overview(db, fx.actors.engineerA);
    expect(oe.projects.every((p) => p.money === null)).toBe(true);
  });
});
