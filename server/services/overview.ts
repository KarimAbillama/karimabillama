/**
 * Weekly progress updates and the owner's overview of all projects.
 *
 * The overview rates each project red / amber / green on programme, approvals (submittals), site
 * reporting, safety and material supply, using the thresholds below. They are PROPOSED defaults
 * (A-30, A-33) and live in one place so they are easy to change once EDGE confirms them.
 * Every figure is computed from records the viewer may see; money needs cost.view.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "../db/client.js";
import {
  companies, materialRequestLines, materialRequests, projectProgressUpdates, projects, purchaseOrders, rfis, siteReports,
  submittalRevisions, submittals, users,
} from "../db/schema.js";
import { type Actor, can, canAccessProject, projectScope, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { addDays, businessToday, daysBetween } from "../lib/dates.js";
import { lastWorkday, workdaysBetween } from "../lib/workdays.js";
import { dec, m2, sum } from "../lib/decimal.js";
import { rule } from "../lib/errors.js";
import { myPendingApprovals } from "./approvals.js";
import { lineFulfilment } from "./materialRequests.js";
import { drillRows } from "./reports.js";
import { submittalState } from "./submittals.js";
import { rfiState } from "./rfis.js";

/** PROPOSED thresholds (A-33). */
export const RAG = {
  programmeAmberBehindPct: 3,
  programmeRedBehindPct: 10,
  progressStaleDays: 14,
  submittalRedOverdueDays: 7,
  rfiRedOverdueDays: 7,
  deliveryRedLateDays: 7,
  siteRedMissingWorkdays: 3,
  safetyLookbackDays: 30,
};
export type Rag = "red" | "amber" | "green" | "none";
const worst = (...r: Rag[]): Rag => (r.includes("red") ? "red" : r.includes("amber") ? "amber" : r.includes("green") ? "green" : "none");

// ───────────── progress ─────────────

export async function addProgressUpdate(db: DB, actor: Actor, input: {
  projectId: string; asOfDate: string; plannedPct: string; actualPct: string; forecastEndDate?: string | null; summary?: string | null; risks?: string | null;
}) {
  requirePerm(actor, "progress.update");
  requireProject(actor, input.projectId, "Project");
  if (input.asOfDate > businessToday()) throw rule("FUTURE_DATE", "Progress cannot be reported for a future date.");
  for (const v of [input.plannedPct, input.actualPct]) if (dec(v).lt(0) || dec(v).gt(100)) throw rule("INVALID_PCT", "Percentages must be between 0 and 100.");
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(projectProgressUpdates).values({
      projectId: input.projectId, asOfDate: input.asOfDate, plannedPct: dec(input.plannedPct).toFixed(2), actualPct: dec(input.actualPct).toFixed(2),
      forecastEndDate: input.forecastEndDate ?? null, summary: input.summary ?? null, risks: input.risks ?? null, createdBy: actor.userId,
    }).returning();
    await audit(tx, actor, "progress.updated", "project", input.projectId, input.projectId, { asOf: u.asOfDate, planned: u.plannedPct, actual: u.actualPct });
    return u;
  });
}

export async function progressHistory(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "project.view");
  requireProject(actor, projectId, "Project");
  return db.select({ u: projectProgressUpdates, byName: users.fullName }).from(projectProgressUpdates)
    .innerJoin(users, eq(users.id, projectProgressUpdates.createdBy))
    .where(eq(projectProgressUpdates.projectId, projectId)).orderBy(desc(projectProgressUpdates.asOfDate), desc(projectProgressUpdates.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.u, byName: r.byName })));
}

// ───────────── overview ─────────────

export async function overview(db: DbOrTx, actor: Actor) {
  requirePerm(actor, "report.view");
  const today = businessToday();
  const scope = projectScope(actor);
  const projectRows = await db.select({ p: projects, clientName: companies.name }).from(projects)
    .leftJoin(companies, eq(companies.id, projects.clientCompanyId))
    .where(and(inArray(projects.status, ["planning", "active", "on_hold"]), scope ? (scope.length ? inArray(projects.id, scope) : sql`false`) : undefined))
    .orderBy(asc(projects.code));
  const visible = projectRows.filter((r) => canAccessProject(actor, r.p.id));
  const ids = visible.map((r) => r.p.id);
  const none = ids.length === 0;
  const showCost = can(actor, "cost.view");
  const showSubmittals = can(actor, "submittal.view");

  // Latest progress per project.
  const progress = none ? [] : await db.select().from(projectProgressUpdates).where(inArray(projectProgressUpdates.projectId, ids))
    .orderBy(desc(projectProgressUpdates.asOfDate), desc(projectProgressUpdates.createdAt));

  // Submittals and their current revisions.
  const subs = none || !showSubmittals ? [] : await db.select().from(submittals).where(and(inArray(submittals.projectId, ids), sql`${submittals.status} <> 'cancelled'`));
  const revs = subs.length ? await db.select().from(submittalRevisions).where(inArray(submittalRevisions.submittalId, subs.map((s) => s.id))) : [];

  const showRfis = can(actor, "rfi.view");
  const openRfis = none || !showRfis ? [] : await db.select().from(rfis).where(and(inArray(rfis.projectId, ids), inArray(rfis.status, ["draft", "internal_review", "returned", "issued", "responded"])));

  // Site reports from the last 30 days (submitted or reviewed count as reported).
  const since = addDays(today, -RAG.safetyLookbackDays);
  const reports = none ? [] : await db.select({
    r: siteReports, headcount: sql<number>`coalesce((select sum(m.headcount) from site_report_manpower m where m.site_report_id = site_reports.id), 0)::int`,
  }).from(siteReports).where(and(inArray(siteReports.projectId, ids), gte(siteReports.reportDate, since), inArray(siteReports.status, ["submitted", "reviewed"])));

  // Purchase orders waiting for delivery and approved requests not yet covered.
  const openPos = none ? [] : await db.select().from(purchaseOrders).where(and(inArray(purchaseOrders.projectId, ids), inArray(purchaseOrders.status, ["approved", "partially_received"])));
  const mrLines = none ? [] : await db.select({ id: materialRequestLines.id, projectId: materialRequests.projectId, requiredDate: materialRequests.requiredDate })
    .from(materialRequestLines).innerJoin(materialRequests, eq(materialRequests.id, materialRequestLines.materialRequestId))
    .where(and(inArray(materialRequests.projectId, ids), eq(materialRequests.status, "approved")));
  const fulfil = await lineFulfilment(db, mrLines.map((l) => l.id));

  const expectedDay = lastWorkday(today);
  const rows = [];
  for (const { p, clientName } of visible) {
    const attention: string[] = [];

    // Programme
    const pu = progress.find((u) => u.projectId === p.id);
    let programmeRag: Rag = "none";
    let programme = null;
    if (pu) {
      const variance = dec(pu.actualPct).minus(pu.plannedPct);
      const stale = daysBetween(pu.asOfDate, today) > RAG.progressStaleDays;
      const lateFinish = !!pu.forecastEndDate && !!p.plannedEndDate && pu.forecastEndDate > p.plannedEndDate;
      programmeRag = variance.lte(-RAG.programmeRedBehindPct) || lateFinish ? "red" : variance.lte(-RAG.programmeAmberBehindPct) || stale ? "amber" : "green";
      programme = { asOf: pu.asOfDate, plannedPct: pu.plannedPct, actualPct: pu.actualPct, variancePct: variance.toFixed(2), forecastEndDate: pu.forecastEndDate,
        plannedEndDate: p.plannedEndDate, lateFinish, stale, summary: pu.summary, risks: pu.risks, rag: programmeRag };
      if (variance.lt(0)) attention.push(`Programme: ${dec(pu.actualPct).toString()}% done vs ${dec(pu.plannedPct).toString()}% planned`);
      if (lateFinish) attention.push(`Forecast finish ${pu.forecastEndDate}, after the planned ${p.plannedEndDate}`);
      if (stale) attention.push(`Progress not updated since ${pu.asOfDate}`);
    } else attention.push("No progress update recorded yet");

    // Approvals
    let approvals = null;
    let approvalsRag: Rag = "none";
    if (showSubmittals) {
      const mine = subs.filter((s) => s.projectId === p.id).map((s) => ({ s, st: submittalState(s, revs.find((v) => v.submittalId === s.id && v.revNo === s.currentRevision), today) }));
      const withConsultant = mine.filter((x) => x.st.ballInCourt === "consultant");
      const overdue = withConsultant.filter((x) => x.st.overdue);
      const maxOverdue = Math.max(0, ...overdue.map((x) => x.st.daysOverdue));
      const toResubmit = mine.filter((x) => x.s.status === "revise_resubmit" || x.s.status === "rejected");
      const lateForSite = mine.filter((x) => x.st.lateForSite);
      approvalsRag = !mine.length ? "none" : lateForSite.length || maxOverdue > RAG.submittalRedOverdueDays ? "red" : overdue.length || toResubmit.length ? "amber" : "green";
      approvals = { total: mine.length, withConsultant: withConsultant.length, overdue: overdue.length, maxOverdueDays: maxOverdue, toResubmit: toResubmit.length,
        lateForSite: lateForSite.length, approved: mine.filter((x) => x.s.status === "approved").length, rag: approvalsRag };
      if (overdue.length) attention.push(`${overdue.length} submittal(s) overdue with the consultant (worst ${maxOverdue} days)`);
      if (toResubmit.length) attention.push(`${toResubmit.length} submittal(s) to revise and resubmit`);
      if (lateForSite.length) attention.push(`${lateForSite.length} submittal(s) not approved by the date site needs them`);
    }

    // RFIs
    let rfiSummary = null;
    let rfiRag: Rag = "none";
    if (showRfis) {
      const mine = openRfis.filter((r) => r.projectId === p.id).map((r) => ({ r, st: rfiState(r, today) }));
      const withConsultant = mine.filter((x) => x.st.ballInCourt === "consultant");
      const overdue = withConsultant.filter((x) => x.st.overdue);
      const maxOverdue = Math.max(0, ...overdue.map((x) => x.st.daysOverdue));
      const blocking = overdue.filter((x) => x.r.blockedActivity);
      const toClose = mine.filter((x) => x.r.status === "responded").length;
      rfiRag = !mine.length ? "green" : maxOverdue > RAG.rfiRedOverdueDays || blocking.length ? "red" : overdue.length ? "amber" : "green";
      rfiSummary = { open: mine.length, withConsultant: withConsultant.length, overdue: overdue.length, maxOverdueDays: maxOverdue, blocking: blocking.length, toClose, rag: rfiRag };
      if (overdue.length) attention.push(`${overdue.length} RFI(s) overdue with the consultant (worst ${maxOverdue} days)${blocking.length ? `, ${blocking.length} holding up site work` : ""}`);
      if (toClose) attention.push(`${toClose} answered RFI(s) to act on and close`);
    }

    // Site reporting and safety
    const pr = reports.filter((x) => x.r.projectId === p.id).sort((a, b) => b.r.reportDate.localeCompare(a.r.reportDate));
    const last = pr[0];
    const lastDate = last?.r.reportDate ?? null;
    const missing = lastDate ? workdaysBetween(lastDate, expectedDay) : workdaysBetween(since, expectedDay);
    const latestDay = pr.filter((x) => x.r.reportDate === lastDate);
    const headcount = latestDay.reduce((a, x) => a + x.headcount, 0);
    const recent = pr.filter((x) => x.r.reportDate > addDays(today, -7));
    const delays = recent.filter((x) => x.r.delayCause);
    const causes = [...new Set(delays.map((x) => x.r.delayCause!))];
    const incidents = pr.reduce((a, x) => a + x.r.safetyIncidents, 0);
    const siteRag: Rag = p.status !== "active" ? "none" : missing >= RAG.siteRedMissingWorkdays ? "red" : missing > 0 || delays.length ? "amber" : "green";
    const safetyRag: Rag = !pr.length ? "none" : incidents > 0 ? "red" : "green";
    if (p.status === "active" && missing > 0) attention.push(lastDate ? `No site report since ${lastDate}` : "No site reports in the last 30 days");
    if (delays.length) attention.push(`Work held up on ${delays.length} day(s) this week: ${causes.join(", ")}`);
    if (incidents) attention.push(`${incidents} safety incident(s) in the last ${RAG.safetyLookbackDays} days`);

    // Material supply
    const latePos = openPos.filter((o) => o.projectId === p.id).map((o) => ({ o, due: o.promisedDate ?? o.requiredDate })).filter((x) => x.due && x.due < today);
    const worstLate = Math.max(0, ...latePos.map((x) => daysBetween(x.due!, today)));
    const uncoveredLate = mrLines.filter((l) => l.projectId === p.id && l.requiredDate <= addDays(today, 3) && fulfil.get(l.id)!.uncovered.gt(0)).length;
    const supplyRag: Rag = worstLate > RAG.deliveryRedLateDays ? "red" : latePos.length || uncoveredLate ? "amber" : "green";
    if (latePos.length) attention.push(`${latePos.length} late deliveries (worst ${worstLate} days)`);
    if (uncoveredLate) attention.push(`${uncoveredLate} material request line(s) needed within 3 days and not covered`);

    // Money (Phase 1 tracks purchasing only; certificates and payments come next)
    let money = null;
    if (showCost) {
      const committed = m2(sum((await drillRows(db, p.id, "committed")).map((r) => r.value)));
      const issued = m2(sum((await drillRows(db, p.id, "issued")).map((r) => r.value)));
      money = { contractValue: p.contractValue, committed, issuedCost: issued, notTracked: ["certified", "paid", "variations", "retention"] };
    }

    rows.push({
      project: { id: p.id, code: p.code, name: p.name, status: p.status, clientName, startDate: p.startDate, plannedEndDate: p.plannedEndDate },
      overall: worst(programmeRag, approvalsRag, rfiRag, siteRag, safetyRag, supplyRag),
      programme, approvals, rfis: rfiSummary,
      site: { lastReportDate: lastDate, missingWorkdays: missing, headcount, delayDays: delays.length, delayCauses: causes, rag: siteRag },
      safety: { incidents, rag: safetyRag },
      supply: { lateDeliveries: latePos.length, worstLateDays: worstLate, uncoveredSoon: uncoveredLate, rag: supplyRag },
      money, attention,
    });
  }
  const rank = { red: 0, amber: 1, green: 2, none: 3 };
  rows.sort((a, b) => rank[a.overall] - rank[b.overall] || a.project.code.localeCompare(b.project.code));
  return {
    today, expectedReportDay: expectedDay, thresholds: RAG,
    totals: {
      projects: rows.length, red: rows.filter((r) => r.overall === "red").length, amber: rows.filter((r) => r.overall === "amber").length,
      headcount: rows.reduce((a, r) => a + r.site.headcount, 0),
      submittalsWithConsultant: rows.reduce((a, r) => a + (r.approvals?.withConsultant ?? 0), 0),
      submittalsOverdue: rows.reduce((a, r) => a + (r.approvals?.overdue ?? 0), 0),
      rfisWithConsultant: rows.reduce((a, r) => a + (r.rfis?.withConsultant ?? 0), 0),
      rfisOverdue: rows.reduce((a, r) => a + (r.rfis?.overdue ?? 0), 0),
      myApprovals: (await myPendingApprovals(db, actor)).length,
    },
    projects: rows,
  };
}
