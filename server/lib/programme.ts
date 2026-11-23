/**
 * Programme arithmetic (pure, no database): planned and actual % complete, the S-curve and how many
 * days ahead or behind the work is. PROPOSED method (A-48):
 *  - an activity's planned % rises in a straight line over its planned calendar days (a milestone
 *    jumps from 0 to 100 on its date);
 *  - the project % is the weighted average of activity %, weighted by planned duration unless the
 *    imported file gave weights (e.g. budgeted cost);
 *  - days ahead/behind = the date on the planned curve that matches today's actual %, minus today
 *    (the "earned schedule" idea).
 * P6 can use other curves and calendars, so figures may differ slightly from P6's own.
 */
import { Decimal, dec } from "./decimal.js";
import { addDays, daysBetween } from "./dates.js";

export interface PlanActivity { code: string; plannedStart: string; plannedFinish: string; isMilestone: boolean; weight: string }
export interface ProgressPoint { activityCode: string; asOfDate: string; pctComplete: string; actualStart: string | null; actualFinish: string | null; recordedAt?: string | Date }

/** Planned % complete of one activity at the end of `date`. */
export function plannedPct(a: PlanActivity, date: string): Decimal {
  if (a.isMilestone) return dec(date >= a.plannedFinish ? 100 : 0);
  if (date < a.plannedStart) return dec(0);
  if (date >= a.plannedFinish) return dec(100);
  return dec(daysBetween(a.plannedStart, date) + 1).div(daysBetween(a.plannedStart, a.plannedFinish) + 1).times(100);
}

/** Weighted average of activity percentages. Falls back to equal weights when every weight is 0. */
export function weightedPct(acts: PlanActivity[], pctOf: (a: PlanActivity) => Decimal): Decimal {
  if (!acts.length) return dec(0);
  const weighted = acts.reduce((s, a) => s.plus(a.weight), dec(0));
  const equal = weighted.isZero();
  const w = (a: PlanActivity) => (equal ? dec(1) : dec(a.weight));
  return acts.reduce((s, a) => s.plus(w(a).times(pctOf(a))), dec(0)).div(equal ? acts.length : weighted);
}

const newer = (x: ProgressPoint, y: ProgressPoint) =>
  x.asOfDate > y.asOfDate || (x.asOfDate === y.asOfDate && String(x.recordedAt ?? "") > String(y.recordedAt ?? ""));

/** The latest progress for each activity, as known on `date` (all history when no date given). */
export function latestProgress(points: ProgressPoint[], date?: string) {
  const m = new Map<string, ProgressPoint>();
  for (const p of points) {
    if (date && p.asOfDate > date) continue;
    const cur = m.get(p.activityCode);
    if (!cur || newer(p, cur)) m.set(p.activityCode, p);
  }
  return m;
}

export const plannedProjectPct = (acts: PlanActivity[], date: string) => weightedPct(acts, (a) => plannedPct(a, date));
export const actualProjectPct = (acts: PlanActivity[], progress: Map<string, ProgressPoint>) =>
  weightedPct(acts, (a) => dec(progress.get(a.code)?.pctComplete ?? 0));

export function programmeDates(acts: PlanActivity[]) {
  if (!acts.length) return { start: null, finish: null };
  return {
    start: acts.reduce((m, a) => (a.plannedStart < m ? a.plannedStart : m), acts[0].plannedStart),
    finish: acts.reduce((m, a) => (a.plannedFinish > m ? a.plannedFinish : m), acts[0].plannedFinish),
  };
}

/**
 * Days ahead (+) or behind (−): the date when the plan expected today's actual % to be reached,
 * minus today. Null before the programme starts.
 */
export function scheduleVarianceDays(acts: PlanActivity[], actual: Decimal, today: string): number | null {
  const { start, finish } = programmeDates(acts);
  if (!start || !finish || today < start) return null;
  if (actual.gte(100)) return Math.max(0, daysBetween(today, finish));
  // Earliest date on the planned curve where planned % ≥ actual % (binary search: the curve never falls).
  let lo = addDays(start, -1);
  let hi = finish;
  if (plannedProjectPct(acts, lo).gte(actual)) return daysBetween(today, lo);
  while (daysBetween(lo, hi) > 1) {
    const mid = addDays(lo, Math.floor(daysBetween(lo, hi) / 2));
    if (plannedProjectPct(acts, mid).gte(actual)) hi = mid; else lo = mid;
  }
  return daysBetween(today, hi);
}

/** Weekly points for the S-curve: planned for the whole programme, actual up to today. */
export function sCurve(acts: PlanActivity[], points: ProgressPoint[], today: string) {
  const { start, finish } = programmeDates(acts);
  if (!start || !finish) return [];
  const dates: string[] = [];
  for (let d = addDays(start, -1); d < finish; d = addDays(d, 7)) dates.push(d);
  dates.push(finish);
  if (today > start && today < finish && !dates.includes(today)) dates.push(today);
  dates.sort();
  return dates.map((d) => ({
    date: d,
    planned: plannedProjectPct(acts, d).toDecimalPlaces(1).toNumber(),
    actual: d <= today ? actualProjectPct(acts, latestProgress(points, d)).toDecimalPlaces(1).toNumber() : null,
  }));
}

export type ActivityState = "not_started" | "in_progress" | "done";
/** Where one activity stands today and what is wrong with it. */
export function activityStatus(a: PlanActivity, p: ProgressPoint | undefined, today: string, behindThresholdPct = 10) {
  const pct = dec(p?.pctComplete ?? 0);
  const state: ActivityState = pct.gte(100) ? "done" : pct.gt(0) || p?.actualStart ? "in_progress" : "not_started";
  const planned = plannedPct(a, today);
  const lateStart = state === "not_started" && a.plannedStart < today;
  const lateFinish = state !== "done" && a.plannedFinish < today;
  const variance = pct.minus(planned);
  const behind = state !== "done" && variance.lte(-behindThresholdPct);
  return {
    state, pct: pct.toDecimalPlaces(1).toNumber(), plannedPct: planned.toDecimalPlaces(1).toNumber(), variancePct: variance.toDecimalPlaces(1).toNumber(),
    lateStart, lateFinish, behind, daysLate: lateFinish ? daysBetween(a.plannedFinish, today) : lateStart ? daysBetween(a.plannedStart, today) : 0,
  };
}

/** Rules a progress entry must follow (same on the server and in the preview). Returns a message or null. */
export function progressProblem(r: { pctComplete: string; actualStart: string | null; actualFinish: string | null }, asOfDate: string): string | null {
  const pct = dec(r.pctComplete);
  if (pct.lt(0) || pct.gt(100)) return "% complete must be from 0 to 100.";
  if (pct.gt(0) && !r.actualStart) return "Enter the actual start date when work has started.";
  if (pct.eq(100) && !r.actualFinish) return "Enter the actual finish date when the activity is 100% complete.";
  if (r.actualFinish && pct.lt(100)) return "An activity with an actual finish must be 100% complete.";
  if (r.actualStart && r.actualStart > asOfDate) return "The actual start cannot be after the progress date.";
  if (r.actualFinish && r.actualFinish > asOfDate) return "The actual finish cannot be after the progress date.";
  if (r.actualStart && r.actualFinish && r.actualFinish < r.actualStart) return "The actual finish is before the actual start.";
  return null;
}
