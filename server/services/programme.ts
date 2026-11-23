/**
 * Programme baseline (from Primavera P6) and progress on site.
 *
 * The planner imports the baseline (P6 .xer or a CSV activity list). Site engineers then record
 * progress per activity here instead of in a separate Excel: % complete, actual start, actual finish.
 * Progress is kept per P6 activity ID, so it carries over to a new baseline. Each save adds history;
 * nothing is overwritten. The progress sheet can also be exported for the planner to update P6.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB, DbOrTx } from "../db/client.js";
import { activityProgress, programmeActivities, programmeBaselines, projects, users } from "../db/schema.js";
import { type Actor, requirePerm, requireProject } from "../auth/actor.js";
import { audit } from "../lib/audit.js";
import { toCsv } from "../lib/csv.js";
import { addDays, businessToday } from "../lib/dates.js";
import { dec } from "../lib/decimal.js";
import { notFound, rule } from "../lib/errors.js";
import { parseProgrammeCsv, parseProgressCsv, parseXer, type ProgressRow } from "../lib/p6.js";
import {
  activityStatus, actualProjectPct, latestProgress, plannedProjectPct, progressProblem, sCurve, scheduleVarianceDays, type PlanActivity, type ProgressPoint,
} from "../lib/programme.js";

/** PROPOSED (A-48): look-ahead windows and when an activity counts as behind. */
export const PROGRAMME_RULES = { lookAheadShortDays: 14, lookAheadLongDays: 42, behindThresholdPct: 10 };

async function currentBaseline(db: DbOrTx, projectId: string) {
  const [b] = await db.select().from(programmeBaselines).where(and(eq(programmeBaselines.projectId, projectId), eq(programmeBaselines.isCurrent, true)));
  return b ?? null;
}
const activitiesOf = (db: DbOrTx, baselineId: string) =>
  db.select().from(programmeActivities).where(eq(programmeActivities.baselineId, baselineId)).orderBy(asc(programmeActivities.sortOrder));
const progressOf = (db: DbOrTx, projectId: string) =>
  db.select().from(activityProgress).where(eq(activityProgress.projectId, projectId)).orderBy(asc(activityProgress.asOfDate), asc(activityProgress.recordedAt));

const toPoint = (p: typeof activityProgress.$inferSelect): ProgressPoint => ({ ...p, recordedAt: p.recordedAt.toISOString() });

export async function importBaseline(db: DB, actor: Actor, projectId: string, input: {
  format: "xer" | "csv"; text: string; fileName?: string | null; name: string; notes?: string | null; dryRun?: boolean;
}) {
  requirePerm(actor, "programme.manage");
  requireProject(actor, projectId, "Project");
  if (!input.name.trim()) throw rule("REQUIRED", "Name the baseline, e.g. \"Baseline rev 0\".");
  const parsed = input.format === "xer" ? parseXer(input.text) : parseProgrammeCsv(input.text);
  const acts = parsed.activities;
  const start = acts.reduce<string | null>((m, a) => (!m || a.plannedStart < m ? a.plannedStart : m), null);
  const finish = acts.reduce<string | null>((m, a) => (!m || a.plannedFinish > m ? a.plannedFinish : m), null);
  const summary = { activities: acts.length, milestones: acts.filter((a) => a.isMilestone).length, skipped: parsed.skipped, plannedStart: start, plannedFinish: finish,
    p6ProjectCode: parsed.projectCode, dataDate: parsed.dataDate };
  if (parsed.problems.length) return { ok: false, saved: false, problems: parsed.problems, warnings: [], ...summary };

  // Progress already recorded against activities that are not in the new baseline.
  const prev = await progressOf(db, projectId);
  const codes = new Set(acts.map((a) => a.code));
  const orphaned = [...new Set(prev.map((p) => p.activityCode))].filter((c) => !codes.has(c));
  const warnings = orphaned.length ? [`${orphaned.length} activity ID(s) with recorded progress are not in this file (${orphaned.slice(0, 5).join(", ")}${orphaned.length > 5 ? "…" : ""}). Their progress is kept but will not count.`] : [];
  if (input.dryRun) return { ok: true, saved: false, problems: [], warnings, ...summary, preview: acts.slice(0, 12) };

  const baseline = await db.transaction(async (tx) => {
    await tx.update(programmeBaselines).set({ isCurrent: false }).where(and(eq(programmeBaselines.projectId, projectId), eq(programmeBaselines.isCurrent, true)));
    const [b] = await tx.insert(programmeBaselines).values({
      projectId, name: input.name.trim(), source: input.format === "xer" ? "p6_xer" : "csv", fileName: input.fileName ?? null, p6ProjectCode: parsed.projectCode,
      dataDate: parsed.dataDate, plannedStart: start!, plannedFinish: finish!, activityCount: acts.length, notes: input.notes ?? null, importedBy: actor.userId,
    }).returning();
    for (let i = 0; i < acts.length; i += 500) {
      await tx.insert(programmeActivities).values(acts.slice(i, i + 500).map((a, j) => ({ baselineId: b.id, sortOrder: i + j + 1, ...a })));
    }
    await audit(tx, actor, "programme.baseline_imported", "project", projectId, projectId, { name: b.name, source: b.source, file: b.fileName, activities: acts.length, start, finish });
    return b;
  });
  return { ok: true, saved: true, baselineId: baseline.id, problems: [], warnings, ...summary };
}

/** The current baseline with every activity's status today, the S-curve and look-aheads. */
export async function getProgramme(db: DbOrTx, actor: Actor, projectId: string) {
  requirePerm(actor, "project.view");
  requireProject(actor, projectId, "Project");
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw notFound("Project");
  const baselines = await db.select({ b: programmeBaselines, byName: users.fullName }).from(programmeBaselines).innerJoin(users, eq(users.id, programmeBaselines.importedBy))
    .where(eq(programmeBaselines.projectId, projectId)).orderBy(desc(programmeBaselines.importedAt));
  const history = baselines.map((x) => ({ ...x.b, importedByName: x.byName }));
  const current = history.find((b) => b.isCurrent) ?? null;
  const today = businessToday();
  if (!current) return { project: { id: p.id, code: p.code, name: p.name, plannedEndDate: p.plannedEndDate }, today, baseline: null, baselines: history, summary: null, curve: [], activities: [], rules: PROGRAMME_RULES };

  const acts = await activitiesOf(db, current.id);
  const points = (await progressOf(db, projectId)).map(toPoint);
  const latest = latestProgress(points);
  const plan: PlanActivity[] = acts;
  const planned = plannedProjectPct(plan, today);
  const actual = actualProjectPct(plan, latest);
  const sv = scheduleVarianceDays(plan, actual, today);
  const lastUpdate = points.reduce<string | null>((m, x) => (!m || x.asOfDate > m ? x.asOfDate : m), null);
  const recorders = new Map<string, string>();
  const ids = [...new Set([...latest.values()].map((x) => (x as unknown as { recordedBy: string }).recordedBy))];
  if (ids.length) for (const u of await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids))) recorders.set(u.id, u.name);

  const rows = acts.map((a) => {
    const lp = latest.get(a.code) as (ProgressPoint & { recordedBy?: string; remark?: string | null }) | undefined;
    const st = activityStatus(a, lp, today, PROGRAMME_RULES.behindThresholdPct);
    return {
      ...a, ...st, actualStart: lp?.actualStart ?? null, actualFinish: lp?.actualFinish ?? null, remark: lp?.remark ?? null,
      lastUpdate: lp ? { asOfDate: lp.asOfDate, byName: recorders.get(lp.recordedBy ?? "") ?? null } : null,
      inShortLookAhead: st.state !== "done" && a.plannedStart <= addDays(today, PROGRAMME_RULES.lookAheadShortDays),
      inLongLookAhead: st.state !== "done" && a.plannedStart <= addDays(today, PROGRAMME_RULES.lookAheadLongDays),
    };
  });
  const forecastFinish = sv !== null && sv < 0 ? addDays(current.plannedFinish, -sv) : current.plannedFinish;
  return {
    project: { id: p.id, code: p.code, name: p.name, plannedEndDate: p.plannedEndDate },
    today, baseline: current, baselines: history, rules: PROGRAMME_RULES,
    summary: {
      plannedPct: planned.toDecimalPlaces(1).toNumber(), actualPct: actual.toDecimalPlaces(1).toNumber(), variancePct: actual.minus(planned).toDecimalPlaces(1).toNumber(),
      daysAheadBehind: sv, forecastFinish, lastUpdate,
      counts: {
        total: rows.length, done: rows.filter((r) => r.state === "done").length, inProgress: rows.filter((r) => r.state === "in_progress").length,
        notStarted: rows.filter((r) => r.state === "not_started").length, lateStart: rows.filter((r) => r.lateStart).length,
        lateFinish: rows.filter((r) => r.lateFinish).length, behind: rows.filter((r) => r.behind).length,
      },
    },
    curve: sCurve(plan, points, today),
    activities: rows,
  };
}

/**
 * Saves a progress sheet. All rows are checked first; if any row has a problem nothing is saved.
 * Rows identical to the latest status are skipped.
 */
export async function recordProgress(db: DB, actor: Actor, projectId: string, input: { asOfDate: string; rows: ProgressRow[]; source?: "screen" | "csv" }) {
  requirePerm(actor, "site.progress");
  requireProject(actor, projectId, "Project");
  if (input.asOfDate > businessToday()) throw rule("FUTURE_DATE", "Progress cannot be dated in the future.");
  const b = await currentBaseline(db, projectId);
  if (!b) throw rule("NO_BASELINE", "Import the programme baseline first.");
  const acts = await activitiesOf(db, b.id);
  const latest = latestProgress((await progressOf(db, projectId)).map(toPoint));
  const problems: string[] = [];
  const toSave: (typeof activityProgress.$inferInsert)[] = [];
  const seen = new Set<string>();
  for (const r of input.rows) {
    const a = acts.find((x) => x.code === r.activityCode);
    if (!a) { problems.push(`${r.activityCode}: not an activity in the current baseline.`); continue; }
    if (seen.has(a.code)) { problems.push(`${a.code}: listed twice.`); continue; }
    seen.add(a.code);
    const pct = dec(r.pctComplete);
    const row = { pctComplete: pct.toFixed(2), actualStart: r.actualStart || null, actualFinish: r.actualFinish || null };
    const prev = latest.get(a.code);
    if (prev && dec(prev.pctComplete).eq(pct) && (prev.actualStart ?? null) === row.actualStart && (prev.actualFinish ?? null) === row.actualFinish) continue;
    if (!prev && pct.isZero() && !row.actualStart) continue;
    const problem = progressProblem(row, input.asOfDate);
    if (problem) { problems.push(`${a.code} ${a.name}: ${problem}`); continue; }
    if (prev && input.asOfDate < prev.asOfDate) { problems.push(`${a.code}: progress dated ${prev.asOfDate} is already recorded; use that date or later.`); continue; }
    if (prev && pct.lt(prev.pctComplete) && !r.remark?.trim()) { problems.push(`${a.code}: % complete is lower than last time (${dec(prev.pctComplete).toString()}%). Add a remark explaining why.`); continue; }
    toSave.push({ projectId, activityCode: a.code, asOfDate: input.asOfDate, ...row, remark: r.remark?.trim() || null, recordedBy: actor.userId });
  }
  if (problems.length) return { ok: false, saved: 0, unchanged: input.rows.length - toSave.length - problems.length, problems };
  if (toSave.length) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < toSave.length; i += 500) await tx.insert(activityProgress).values(toSave.slice(i, i + 500));
      await audit(tx, actor, "programme.progress_recorded", "project", projectId, projectId, { asOf: input.asOfDate, activities: toSave.length, source: input.source ?? "screen" });
    });
  }
  return { ok: true, saved: toSave.length, unchanged: input.rows.length - toSave.length, problems };
}

export async function importProgressCsv(db: DB, actor: Actor, projectId: string, input: { asOfDate: string; csv: string }) {
  requirePerm(actor, "site.progress");
  requireProject(actor, projectId, "Project");
  const parsed = parseProgressCsv(input.csv);
  if (parsed.problems.length) return { ok: false, saved: 0, unchanged: 0, problems: parsed.problems };
  return recordProgress(db, actor, projectId, { asOfDate: input.asOfDate, rows: parsed.rows, source: "csv" });
}

/** The progress sheet as CSV: for site engineers who still want Excel, and for the planner to update P6. */
export async function progressSheetCsv(db: DbOrTx, actor: Actor, projectId: string) {
  const prog = await getProgramme(db, actor, projectId);
  if (!prog.baseline) throw rule("NO_BASELINE", "No programme baseline yet.");
  const rows = prog.activities.map((a) => ({
    activity_id: a.code, activity_name: a.name, wbs_code: a.wbsCode ?? "", wbs_name: a.wbsName ?? "", planned_start: a.plannedStart, planned_finish: a.plannedFinish,
    pct_complete: String(a.pct), actual_start: a.actualStart ?? "", actual_finish: a.actualFinish ?? "", remark: a.remark ?? "", planned_pct_today: String(a.plannedPct),
    status: a.lateFinish ? "late finish" : a.lateStart ? "late start" : a.behind ? "behind" : a.state.replace("_", " "), last_updated: a.lastUpdate?.asOfDate ?? "",
  }));
  const keys = Object.keys(rows[0] ?? { activity_id: "" }) as (keyof (typeof rows)[number])[];
  const csv = toCsv(rows, keys.map((k) => ({ key: k, header: k })));
  return { csv, fileName: `${prog.project.code}-progress-${prog.today}.csv` };
}

export async function activityHistory(db: DbOrTx, actor: Actor, projectId: string, code: string) {
  requirePerm(actor, "project.view");
  requireProject(actor, projectId, "Project");
  return db.select({ asOfDate: activityProgress.asOfDate, pctComplete: activityProgress.pctComplete, actualStart: activityProgress.actualStart, actualFinish: activityProgress.actualFinish,
    remark: activityProgress.remark, byName: users.fullName, recordedAt: activityProgress.recordedAt })
    .from(activityProgress).innerJoin(users, eq(users.id, activityProgress.recordedBy))
    .where(and(eq(activityProgress.projectId, projectId), eq(activityProgress.activityCode, code))).orderBy(desc(activityProgress.asOfDate), desc(activityProgress.recordedAt));
}

/** Programme figures for the owner's overview, for projects that have a baseline. */
export async function programmeSnapshot(db: DbOrTx, projectIds: string[]) {
  const out = new Map<string, { baselineName: string; plannedPct: string; actualPct: string; daysAheadBehind: number | null; forecastFinish: string; plannedFinish: string; lastUpdate: string | null; lateActivities: number }>();
  if (!projectIds.length) return out;
  const today = businessToday();
  const bs = await db.select().from(programmeBaselines).where(and(inArray(programmeBaselines.projectId, projectIds), eq(programmeBaselines.isCurrent, true)));
  for (const b of bs) {
    const acts = await activitiesOf(db, b.id);
    const points = (await progressOf(db, b.projectId)).map(toPoint);
    const latest = latestProgress(points);
    const planned = plannedProjectPct(acts, today);
    const actual = actualProjectPct(acts, latest);
    const sv = scheduleVarianceDays(acts, actual, today);
    out.set(b.projectId, {
      baselineName: b.name, plannedPct: planned.toFixed(2), actualPct: actual.toFixed(2), daysAheadBehind: sv,
      forecastFinish: sv !== null && sv < 0 ? addDays(b.plannedFinish, -sv) : b.plannedFinish, plannedFinish: b.plannedFinish,
      lastUpdate: points.reduce<string | null>((m, x) => (!m || x.asOfDate > m ? x.asOfDate : m), null),
      lateActivities: acts.filter((a) => { const s = activityStatus(a, latest.get(a.code), today); return s.lateFinish || s.lateStart; }).length,
    });
  }
  return out;
}
