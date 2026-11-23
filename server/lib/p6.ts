/**
 * Reading programme files: a Primavera P6 export (.xer) or an activity list saved from Excel (.csv).
 * Pure functions, no database: they return activities plus a list of problems with row numbers.
 *
 * XER is P6's own export: tab-separated tables, each introduced by "%T <table>", a "%F" line of
 * field names and "%R" rows. We read PROJECT, PROJWBS and TASK. Planned dates are TASK
 * target_start_date / target_end_date ("Planned Start" / "Planned Finish" in P6). Level-of-effort and
 * WBS-summary activities are skipped because they would double-count work. See A-47.
 */
import { parseCsv, parseDate } from "./csvRead.js";
import { daysBetween } from "./dates.js";

export interface ImportedActivity {
  code: string; name: string; wbsCode: string | null; wbsName: string | null;
  plannedStart: string; plannedFinish: string; durationDays: number; isMilestone: boolean;
  /** Relative weight for overall % complete (planned duration unless the file gives one). */
  weight: string;
}
export interface ProgrammeFile { projectCode: string | null; dataDate: string | null; activities: ImportedActivity[]; problems: string[]; skipped: number }

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/**
 * Dates as P6 and Excel write them: 2026-09-01, 2026-09-01 08:00, 01/09/2026, 01-Sep-26, 01-Sep-2026 08:00 A.
 * A trailing "A" (actual) or "*" (constraint) marker and a time of day are ignored.
 */
export function parseFlexDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const t = v.trim().replace(/\s*[A*]$/, "").replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, "").trim();
  const mon = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{2}|\d{4})$/.exec(t);
  if (mon) {
    const m = MONTHS[mon[2].toLowerCase()];
    if (!m) return null;
    const y = mon[3].length === 2 ? `20${mon[3]}` : mon[3];
    return parseDate(`${y}-${m}-${mon[1].padStart(2, "0")}`);
  }
  return parseDate(t);
}

/** "Activity % Complete" → "activity_complete"; "Activity ID" → "activity_id". */
export const normaliseHeader = (h: string) => h.toLowerCase().replace(/%/g, " pct ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function pickColumn(row: Record<string, string>, aliases: string[]): string | undefined {
  for (const a of aliases) if (row[a] !== undefined && row[a] !== "") return row[a];
  return undefined;
}

export function normalisedRows(text: string) {
  return parseCsv(text).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normaliseHeader(k), v])));
}

const num = (v: string | undefined) => {
  if (v === undefined) return null;
  const t = v.replace(/,/g, "").replace(/\s*(d|days?|h|hrs?)$/i, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function finish(activities: ImportedActivity[], problems: string[]) {
  const seen = new Set<string>();
  for (const a of activities) {
    if (seen.has(a.code)) problems.push(`Activity ${a.code} appears more than once.`);
    seen.add(a.code);
  }
  if (!activities.length && !problems.length) problems.push("No activities found in the file.");
}

// ───────────── XER ─────────────

export function parseXer(text: string): ProgrammeFile {
  const tables = new Map<string, Record<string, string>[]>();
  let current: string | null = null;
  let fields: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split("\t");
    if (parts[0] === "%T") { current = parts[1]?.trim() ?? null; fields = []; if (current) tables.set(current, []); }
    else if (parts[0] === "%F") fields = parts.slice(1).map((f) => f.trim());
    else if (parts[0] === "%R" && current) tables.get(current)!.push(Object.fromEntries(fields.map((f, i) => [f, (parts[i + 1] ?? "").trim()])));
  }
  const problems: string[] = [];
  if (!tables.has("TASK")) return { projectCode: null, dataDate: null, activities: [], problems: ["This does not look like a P6 XER export (no TASK table found)."], skipped: 0 };
  const projectsT = tables.get("PROJECT") ?? [];
  const tasks = tables.get("TASK")!;
  const projIds = [...new Set(tasks.map((t) => t.proj_id))];
  if (projIds.length > 1) {
    const names = projIds.map((id) => projectsT.find((p) => p.proj_id === id)?.proj_short_name ?? id).join(", ");
    return { projectCode: null, dataDate: null, activities: [], problems: [`The file holds ${projIds.length} projects (${names}). Export one project at a time from P6.`], skipped: 0 };
  }
  const proj = projectsT.find((p) => p.proj_id === projIds[0]);
  const wbs = new Map((tables.get("PROJWBS") ?? []).map((w) => [w.wbs_id, w]));
  const wbsPath = (id: string) => {
    const codes: string[] = [];
    const names: string[] = [];
    for (let w = wbs.get(id), guard = 0; w && w.proj_node_flag !== "Y" && guard < 50; w = wbs.get(w.parent_wbs_id), guard++) {
      codes.unshift(w.wbs_short_name);
      names.unshift(w.wbs_name);
    }
    return { code: codes.length ? codes.join(".") : null, name: names.length ? names.join(" › ") : null };
  };
  const activities: ImportedActivity[] = [];
  let skipped = 0;
  tasks.forEach((t, i) => {
    const row = `Activity ${t.task_code || `row ${i + 1}`}`;
    if (t.task_type === "TT_LOE" || t.task_type === "TT_WBS") { skipped++; return; }
    const isMilestone = t.task_type === "TT_Mile" || t.task_type === "TT_FinMile";
    let start = parseFlexDate(t.target_start_date);
    let end = parseFlexDate(t.target_end_date);
    if (isMilestone) { const d = t.task_type === "TT_FinMile" ? end ?? start : start ?? end; start = d; end = d; }
    if (!t.task_code) { problems.push(`TASK row ${i + 1}: no activity ID.`); return; }
    if (!start || !end) { problems.push(`${row}: planned start or finish missing.`); return; }
    if (end < start) { problems.push(`${row}: finish ${end} is before start ${start}.`); return; }
    const hours = num(t.target_drtn_hr_cnt);
    const calDays = daysBetween(start, end) + 1;
    const w = wbsPath(t.wbs_id);
    activities.push({
      code: t.task_code, name: t.task_name || t.task_code, wbsCode: w.code, wbsName: w.name, plannedStart: start, plannedFinish: end,
      durationDays: isMilestone ? 0 : hours !== null ? Math.round(hours / 8) : calDays, isMilestone,
      weight: isMilestone ? "0" : String(hours !== null && hours > 0 ? hours : calDays),
    });
  });
  finish(activities, problems);
  return { projectCode: proj?.proj_short_name ?? null, dataDate: parseFlexDate(proj?.last_recalc_date), activities, problems, skipped };
}

// ───────────── CSV (activity list exported from P6 to Excel, or typed by the planner) ─────────────

export const ACTIVITY_COLUMNS = {
  code: ["activity_id", "task_code", "activity_code", "id"],
  name: ["activity_name", "task_name", "name", "description"],
  start: ["planned_start", "bl_project_start", "bl1_start", "baseline_start", "target_start_date", "start"],
  finish: ["planned_finish", "bl_project_finish", "bl1_finish", "baseline_finish", "target_end_date", "finish"],
  wbs: ["wbs_code", "wbs", "wbs_path"],
  wbsName: ["wbs_name"],
  duration: ["original_duration", "planned_duration", "duration_days", "duration"],
  weight: ["weight", "budgeted_total_cost", "budgeted_labor_units"],
  type: ["activity_type", "type", "milestone"],
};

export function parseProgrammeCsv(text: string): ProgrammeFile {
  const rows = normalisedRows(text);
  const problems: string[] = [];
  const activities: ImportedActivity[] = [];
  if (rows.length && pickColumn(rows[0], ACTIVITY_COLUMNS.code) === undefined && !ACTIVITY_COLUMNS.code.some((c) => c in rows[0])) {
    return { projectCode: null, dataDate: null, activities, skipped: 0, problems: ["No \"Activity ID\" column. The file needs at least: Activity ID, Activity Name, Start (or Planned Start), Finish (or Planned Finish)."] };
  }
  rows.forEach((r, i) => {
    const line = `Row ${i + 2}`;
    const code = pickColumn(r, ACTIVITY_COLUMNS.code);
    if (!code) { problems.push(`${line}: activity ID is empty.`); return; }
    const type = (pickColumn(r, ACTIVITY_COLUMNS.type) ?? "").toLowerCase();
    const startRaw = pickColumn(r, ACTIVITY_COLUMNS.start);
    const finishRaw = pickColumn(r, ACTIVITY_COLUMNS.finish);
    let start = parseFlexDate(startRaw);
    let end = parseFlexDate(finishRaw);
    const isMilestone = type.includes("mile") || ["yes", "y", "true", "1"].includes(type);
    if (isMilestone) { start = start ?? end; end = end ?? start; }
    if (!start || !end) { problems.push(`${line} (${code}): start and finish must be dates like 01/09/2026 or 01-Sep-26.`); return; }
    if (end < start) { problems.push(`${line} (${code}): finish ${end} is before start ${start}.`); return; }
    const calDays = daysBetween(start, end) + 1;
    const dur = num(pickColumn(r, ACTIVITY_COLUMNS.duration));
    const weightRaw = pickColumn(r, ACTIVITY_COLUMNS.weight);
    const weight = weightRaw !== undefined ? num(weightRaw) : null;
    if (weightRaw !== undefined && (weight === null || weight < 0)) { problems.push(`${line} (${code}): weight "${weightRaw}" is not a number.`); return; }
    activities.push({
      code, name: pickColumn(r, ACTIVITY_COLUMNS.name) ?? code, wbsCode: pickColumn(r, ACTIVITY_COLUMNS.wbs) ?? null, wbsName: pickColumn(r, ACTIVITY_COLUMNS.wbsName) ?? null,
      plannedStart: start, plannedFinish: isMilestone ? start : end, durationDays: isMilestone ? 0 : dur ?? calDays, isMilestone,
      weight: isMilestone ? "0" : String(weight ?? (dur && dur > 0 ? dur : calDays)),
    });
  });
  finish(activities, problems);
  return { projectCode: null, dataDate: null, activities, problems, skipped: 0 };
}

// ───────────── Progress sheet (site engineers' Excel) ─────────────

export interface ProgressRow { activityCode: string; pctComplete: string; actualStart: string | null; actualFinish: string | null; remark: string | null }
export const PROGRESS_COLUMNS = {
  pct: ["pct_complete", "percent_complete", "progress_pct", "activity_pct_complete", "physical_pct_complete", "progress"],
  actualStart: ["actual_start", "act_start_date"],
  actualFinish: ["actual_finish", "act_end_date"],
  remark: ["remark", "remarks", "comment", "notes"],
};

export function parseProgressCsv(text: string): { rows: ProgressRow[]; problems: string[] } {
  const rows: ProgressRow[] = [];
  const problems: string[] = [];
  normalisedRows(text).forEach((r, i) => {
    const line = `Row ${i + 2}`;
    const code = pickColumn(r, ACTIVITY_COLUMNS.code);
    if (!code) { problems.push(`${line}: activity ID is empty.`); return; }
    const pctRaw = (pickColumn(r, PROGRESS_COLUMNS.pct) ?? "").replace("%", "").trim();
    const pct = num(pctRaw);
    if (pct === null || pct < 0 || pct > 100) { problems.push(`${line} (${code}): % complete "${pctRaw}" must be a number from 0 to 100.`); return; }
    const s = pickColumn(r, PROGRESS_COLUMNS.actualStart);
    const f = pickColumn(r, PROGRESS_COLUMNS.actualFinish);
    const actualStart = s ? parseFlexDate(s) : null;
    const actualFinish = f ? parseFlexDate(f) : null;
    if (s && !actualStart) { problems.push(`${line} (${code}): actual start "${s}" is not a date.`); return; }
    if (f && !actualFinish) { problems.push(`${line} (${code}): actual finish "${f}" is not a date.`); return; }
    rows.push({ activityCode: code, pctComplete: String(pct), actualStart, actualFinish, remark: pickColumn(r, PROGRESS_COLUMNS.remark) ?? null });
  });
  return { rows, problems };
}
