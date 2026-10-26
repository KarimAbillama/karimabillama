/**
 * Daily site reports: the structured replacement for WhatsApp updates.
 *
 *   draft → submitted → reviewed (accepted by the PM) or returned (with a comment) → resubmitted
 *
 * One report per site per day (enforced in the database). A report can be written up to
 * REPORT_BACKFILL_DAYS late (A-31). The reviewer may not review their own report (A-32).
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB, DbOrTx, Tx } from "../db/client.js";
import { companies, projects, siteReportManpower, siteReports, sites, users } from "../db/schema.js";
import { type Actor, projectScope, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { addDays, businessToday } from "../lib/dates.js";
import { conflict, notFound, pgCode, rule } from "../lib/errors.js";

export const DELAY_CAUSES = ["consultant", "client", "subcontractor", "material", "labour", "equipment", "weather", "authority", "other"] as const;
export const REPORT_BACKFILL_DAYS = 7;

export interface ManpowerInput { trade: string; companyId?: string | null; headcount: number }
export interface SiteReportInput {
  projectId: string; siteId?: string | null; reportDate: string; weather?: string | null; workDone: string; issues?: string | null;
  delayCause?: (typeof DELAY_CAUSES)[number] | null; inspections?: string | null; visitors?: string | null;
  safetyIncidents?: number; safetyNotes?: string | null; manpower: ManpowerInput[];
}

async function validate(tx: DbOrTx, input: Omit<SiteReportInput, "reportDate">) {
  if (input.siteId) {
    const [s] = await tx.select().from(sites).where(and(eq(sites.id, input.siteId), eq(sites.projectId, input.projectId)));
    if (!s) throw rule("INVALID_SITE", "The site does not belong to this project.");
  }
  for (const m of input.manpower) {
    if (!m.trade.trim()) throw rule("TRADE_REQUIRED", "Each manpower line needs a trade.");
    if (!Number.isInteger(m.headcount) || m.headcount <= 0) throw rule("INVALID_HEADCOUNT", "Headcount must be a whole number above zero.");
  }
  const companyIds = [...new Set(input.manpower.map((m) => m.companyId).filter((x): x is string => !!x))];
  if (companyIds.length) {
    const found = await tx.select({ id: companies.id }).from(companies).where(inArray(companies.id, companyIds));
    if (found.length !== companyIds.length) throw rule("UNKNOWN_COMPANY", "One or more subcontractors do not exist.");
  }
  if ((input.safetyIncidents ?? 0) > 0 && !input.safetyNotes?.trim()) throw rule("SAFETY_NOTES_REQUIRED", "Describe the safety incident.");
  if (input.delayCause && !input.issues?.trim()) throw rule("ISSUES_REQUIRED", "Describe what held the work up.");
}

const fields = (i: Omit<SiteReportInput, "projectId" | "siteId" | "reportDate" | "manpower">) => ({
  weather: i.weather ?? null, workDone: i.workDone.trim(), issues: i.issues ?? null, delayCause: i.delayCause ?? null, inspections: i.inspections ?? null,
  visitors: i.visitors ?? null, safetyIncidents: i.safetyIncidents ?? 0, safetyNotes: i.safetyNotes ?? null,
});

export async function createSiteReport(db: DB, actor: Actor, input: SiteReportInput) {
  requirePerm(actor, "sitereport.create");
  requireProject(actor, input.projectId, "Project");
  const today = businessToday();
  if (input.reportDate > today) throw rule("FUTURE_DATE", "A daily report cannot be for a future date.");
  if (input.reportDate < addDays(today, -REPORT_BACKFILL_DAYS)) throw rule("TOO_LATE", `Daily reports can be written up to ${REPORT_BACKFILL_DAYS} days late.`);
  try {
    return await db.transaction(async (tx) => {
      await validate(tx, input);
      const [r] = await tx.insert(siteReports).values({
        projectId: input.projectId, siteId: input.siteId ?? null, reportDate: input.reportDate, status: "draft", createdBy: actor.userId, ...fields(input),
      }).returning();
      if (input.manpower.length) await tx.insert(siteReportManpower).values(input.manpower.map((m) => ({ siteReportId: r.id, trade: m.trade.trim(), companyId: m.companyId ?? null, headcount: m.headcount })));
      await audit(tx, actor, "sitereport.created", "site_report", r.id, r.projectId, { date: r.reportDate });
      return r;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw rule("REPORT_EXISTS", "There is already a report for this site and day. Open it instead.");
    throw e;
  }
}

async function lockReport(tx: Tx, actor: Actor, id: string, version?: number) {
  const res = await tx.execute<{ id: string }>(sql`select id from site_reports where id = ${id} for update`);
  if (!res.rows.length) throw notFound("Site report");
  const [r] = await tx.select().from(siteReports).where(eq(siteReports.id, id));
  requireProject(actor, r.projectId, "Site report");
  if (version !== undefined && version !== r.version) throw conflict("This report was changed by someone else. Reload and try again.");
  return r;
}

export async function updateSiteReport(db: DB, actor: Actor, id: string, input: Omit<SiteReportInput, "projectId" | "reportDate"> & { version: number }) {
  requirePerm(actor, "sitereport.create");
  return db.transaction(async (tx) => {
    const r = await lockReport(tx, actor, id, input.version);
    if (!["draft", "returned"].includes(r.status)) throw rule("INVALID_STATE", "Only a draft or returned report can be edited.");
    await validate(tx, { ...input, projectId: r.projectId });
    const [u] = await tx.update(siteReports).set({ siteId: input.siteId ?? r.siteId, ...fields(input), version: r.version + 1, updatedAt: new Date() }).where(eq(siteReports.id, id)).returning();
    await tx.delete(siteReportManpower).where(eq(siteReportManpower.siteReportId, id));
    if (input.manpower.length) await tx.insert(siteReportManpower).values(input.manpower.map((m) => ({ siteReportId: id, trade: m.trade.trim(), companyId: m.companyId ?? null, headcount: m.headcount })));
    await audit(tx, actor, "sitereport.updated", "site_report", id, r.projectId, { date: r.reportDate });
    return u;
  });
}

export async function submitSiteReport(db: DB, actor: Actor, id: string, version?: number) {
  requirePerm(actor, "sitereport.create");
  return db.transaction(async (tx) => {
    const r = await lockReport(tx, actor, id, version);
    if (!["draft", "returned"].includes(r.status)) throw rule("INVALID_STATE", "This report has already been submitted.");
    if (!r.workDone.trim()) throw rule("WORK_REQUIRED", "Say what work was done (or why none was done).");
    await tx.update(siteReports).set({ status: "submitted", submittedAt: new Date(), version: r.version + 1, updatedAt: new Date() }).where(eq(siteReports.id, id));
    await audit(tx, actor, "sitereport.submitted", "site_report", id, r.projectId, { date: r.reportDate });
  });
}

export async function reviewSiteReport(db: DB, actor: Actor, id: string, decision: "accept" | "return", comment?: string | null) {
  requirePerm(actor, "sitereport.review");
  return db.transaction(async (tx) => {
    const r = await lockReport(tx, actor, id);
    if (r.status !== "submitted") throw rule("INVALID_STATE", "Only a submitted report can be reviewed.");
    if (r.createdBy === actor.userId) throw rule("OWN_REPORT", "You cannot review a report you wrote.");
    if (decision === "return" && !comment?.trim()) throw rule("COMMENT_REQUIRED", "Say what needs to be corrected.");
    await tx.update(siteReports).set({
      status: decision === "accept" ? "reviewed" : "returned", reviewedBy: actor.userId, reviewedAt: new Date(), reviewComment: comment ?? null, version: r.version + 1, updatedAt: new Date(),
    }).where(eq(siteReports.id, id));
    await audit(tx, actor, decision === "accept" ? "sitereport.accepted" : "sitereport.returned", "site_report", id, r.projectId, { date: r.reportDate, comment: comment ?? null });
  });
}

const author = alias(users, "author");
const reviewer = alias(users, "reviewer");

export async function listSiteReports(db: DbOrTx, actor: Actor, f: { projectId?: string; from?: string; to?: string; status?: string; limit?: number }) {
  requirePerm(actor, "project.view");
  const scope = projectScope(actor);
  if (f.projectId) requireProject(actor, f.projectId, "Project");
  const rows = await db.select({
    r: siteReports, projectCode: projects.code, siteName: sites.name, authorName: author.fullName,
    headcount: sql<number>`coalesce((select sum(m.headcount) from site_report_manpower m where m.site_report_id = site_reports.id), 0)::int`,
  }).from(siteReports)
    .innerJoin(projects, eq(projects.id, siteReports.projectId))
    .leftJoin(sites, eq(sites.id, siteReports.siteId))
    .innerJoin(author, eq(author.id, siteReports.createdBy))
    .where(and(
      scope ? (scope.length ? inArray(siteReports.projectId, scope) : sql`false`) : undefined,
      f.projectId ? eq(siteReports.projectId, f.projectId) : undefined,
      f.from ? gte(siteReports.reportDate, f.from) : undefined,
      f.to ? lte(siteReports.reportDate, f.to) : undefined,
      f.status ? eq(siteReports.status, f.status as "draft") : undefined,
    ))
    .orderBy(desc(siteReports.reportDate), asc(projects.code)).limit(f.limit ?? 100);
  return rows.map((x) => ({
    id: x.r.id, projectId: x.r.projectId, projectCode: x.projectCode, siteName: x.siteName, reportDate: x.r.reportDate, status: x.r.status,
    headcount: x.headcount, delayCause: x.r.delayCause, safetyIncidents: x.r.safetyIncidents, authorName: x.authorName,
    summary: x.r.workDone.slice(0, 140),
  }));
}

export async function getSiteReport(db: DbOrTx, actor: Actor, id: string) {
  requirePerm(actor, "project.view");
  const [x] = await db.select({ r: siteReports, projectCode: projects.code, projectName: projects.name, siteName: sites.name, authorName: author.fullName, reviewerName: reviewer.fullName })
    .from(siteReports)
    .innerJoin(projects, eq(projects.id, siteReports.projectId))
    .leftJoin(sites, eq(sites.id, siteReports.siteId))
    .innerJoin(author, eq(author.id, siteReports.createdBy))
    .leftJoin(reviewer, eq(reviewer.id, siteReports.reviewedBy))
    .where(eq(siteReports.id, id));
  if (!x) throw notFound("Site report");
  requireProject(actor, x.r.projectId, "Site report");
  const manpower = await db.select({ id: siteReportManpower.id, trade: siteReportManpower.trade, companyId: siteReportManpower.companyId, companyName: companies.name, headcount: siteReportManpower.headcount })
    .from(siteReportManpower).leftJoin(companies, eq(companies.id, siteReportManpower.companyId))
    .where(eq(siteReportManpower.siteReportId, id)).orderBy(asc(siteReportManpower.trade));
  return { ...x.r, projectCode: x.projectCode, projectName: x.projectName, siteName: x.siteName, authorName: x.authorName, reviewerName: x.reviewerName,
    manpower, totalHeadcount: manpower.reduce((a, m) => a + m.headcount, 0) };
}
