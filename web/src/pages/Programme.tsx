import { useMemo, useState } from "react";
import { get, post, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Field, Loading, Page, fmtDate, todayDubai, useApp } from "../ui";
import { readTextFile } from "../files";
import { ProjectPicker, usePageProject } from "./Contract";

interface Activity {
  id: string; code: string; name: string; wbsCode: string | null; wbsName: string | null; plannedStart: string; plannedFinish: string; durationDays: number; isMilestone: boolean;
  state: "not_started" | "in_progress" | "done"; pct: number; plannedPct: number; variancePct: number; lateStart: boolean; lateFinish: boolean; behind: boolean; daysLate: number;
  actualStart: string | null; actualFinish: string | null; remark: string | null; lastUpdate: { asOfDate: string; byName: string | null } | null; inShortLookAhead: boolean; inLongLookAhead: boolean;
}
interface Baseline { id: string; name: string; source: string; fileName: string | null; p6ProjectCode: string | null; dataDate: string | null; plannedStart: string; plannedFinish: string; activityCount: number; isCurrent: boolean; importedAt: string; importedByName: string }
interface ProgrammeView {
  project: { id: string; code: string; name: string; plannedEndDate: string | null }; today: string; baseline: Baseline | null; baselines: Baseline[];
  summary: { plannedPct: number; actualPct: number; variancePct: number; daysAheadBehind: number | null; forecastFinish: string; lastUpdate: string | null;
    counts: { total: number; done: number; inProgress: number; notStarted: number; lateStart: number; lateFinish: number; behind: number } } | null;
  curve: { date: string; planned: number; actual: number | null }[]; activities: Activity[]; rules: { lookAheadShortDays: number; lookAheadLongDays: number; behindThresholdPct: number };
}
interface Row { pct: string; actualStart: string; actualFinish: string; remark: string }
interface SaveResult { ok: boolean; saved: number; unchanged: number; problems: string[] }
type View = "attention" | "short" | "long" | "all";

const STATE_BADGE = (a: Activity) =>
  a.state === "done" ? ["Done", "green"] : a.lateFinish ? [`Late finish · ${a.daysLate}d`, "red"] : a.lateStart ? [`Late start · ${a.daysLate}d`, "red"] : a.behind ? ["Behind", "amber"] : a.state === "in_progress" ? ["In progress", "blue"] : ["Not started", "grey"];

/** The P6 baseline and the progress of each activity on site (replaces the site engineers' Excel). */
export function ProgrammePage() {
  const { can } = useApp();
  const [projectId, setProjectId] = usePageProject();
  const { data, error, loading, reload } = useApi<ProgrammeView>(projectId ? `/api/projects/${projectId}/programme` : null);
  const [view, setView] = useState<View>("attention");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [asOf, setAsOf] = useState(todayDubai());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [result, setResult] = useState<SaveResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [importing, setImporting] = useState<"baseline" | "progress" | null>(null);
  const [history, setHistory] = useState<{ a: Activity; rows: { asOfDate: string; pctComplete: string; actualStart: string | null; actualFinish: string | null; remark: string | null; byName: string }[] } | null>(null);

  const list = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    return data.activities.filter((a) => {
      if (t && !`${a.code} ${a.name} ${a.wbsCode ?? ""} ${a.wbsName ?? ""}`.toLowerCase().includes(t)) return false;
      if (editing || view === "all" || t) return true;
      if (view === "attention") return a.lateStart || a.lateFinish || a.behind;
      return view === "short" ? a.inShortLookAhead : a.inLongLookAhead;
    });
  }, [data, q, view, editing]);

  const startEdit = () => {
    if (!data) return;
    setRows(Object.fromEntries(data.activities.map((a) => [a.code, { pct: String(a.pct), actualStart: a.actualStart ?? "", actualFinish: a.actualFinish ?? "", remark: "" }])));
    setEditing(true); setResult(null);
  };
  const changed = data ? data.activities.filter((a) => {
    const r = rows[a.code];
    return r && (Number(r.pct) !== a.pct || r.actualStart !== (a.actualStart ?? "") || r.actualFinish !== (a.actualFinish ?? "") || r.remark.trim() !== "");
  }) : [];
  const save = async () => {
    setErr(null); setResult(null);
    try {
      const r = await post<SaveResult>(`/api/projects/${projectId}/programme/progress`, {
        asOfDate: asOf, rows: changed.map((a) => ({ activityCode: a.code, pctComplete: rows[a.code].pct || "0", actualStart: rows[a.code].actualStart || null, actualFinish: rows[a.code].actualFinish || null, remark: rows[a.code].remark || null })),
      });
      setResult(r);
      if (r.ok) { setEditing(false); reload(); }
    } catch (e) { setErr(e as ApiError); }
  };
  const setRow = (code: string, patch: Partial<Row>) => setRows((x) => {
    const next = { ...x[code], ...patch };
    // Helpful defaults, as site engineers fill them in Excel today.
    if (patch.pct !== undefined && Number(patch.pct) > 0 && !next.actualStart) next.actualStart = asOf;
    if (patch.pct !== undefined && Number(patch.pct) === 100 && !next.actualFinish) next.actualFinish = asOf;
    if (patch.pct !== undefined && Number(patch.pct) < 100) next.actualFinish = "";
    return { ...x, [code]: next };
  });
  const showHistory = async (a: Activity) => setHistory({ a, rows: await get(`/api/projects/${projectId}/programme/activities/${encodeURIComponent(a.code)}/history`) });

  const s = data?.summary;
  return (
    <Page title="Programme and progress" subtitle="The baseline from Primavera P6 and the progress of each activity on site. Site engineers update here instead of in Excel."
      actions={data?.baseline && <>
        {can("site.progress") && !editing && <button className="btn primary" onClick={startEdit}>Update progress</button>}
        <a className="btn secondary" href={`/api/projects/${projectId}/programme/progress.csv`}>Export to Excel</a>
      </>}>
      <ProjectPicker value={projectId} onChange={(id) => { setProjectId(id); setEditing(false); setImporting(null); }} />
      <ErrorBox error={error ?? err} />
      {loading && !data ? <Loading /> : data && (<>
        {!data.baseline && (
          <Card><Empty>No programme baseline for {data.project.code} yet.{can("programme.manage") ? " Export the baseline from P6 (File → Export → XER) or as an Excel activity list, and import it here." : " The planner or project manager imports it from P6."}</Empty>
            {can("programme.manage") && <button className="btn primary" onClick={() => setImporting("baseline")}>Import baseline</button>}</Card>
        )}
        {importing === "baseline" && <BaselineImport projectId={projectId} hasBaseline={!!data.baseline} onDone={() => { setImporting(null); reload(); }} onCancel={() => setImporting(null)} />}
        {data.baseline && s && (<>
          <div className="kpis">
            <Kpi label="Planned to date" value={`${s.plannedPct}%`} />
            <Kpi label="Actual to date" value={`${s.actualPct}%`} note={`${s.variancePct > 0 ? "+" : ""}${s.variancePct} points vs plan`} tone={s.variancePct <= -10 ? "red" : s.variancePct <= -3 ? "amber" : "green"} />
            <Kpi label="Ahead / behind" value={s.daysAheadBehind === null ? "—" : s.daysAheadBehind < 0 ? `${-s.daysAheadBehind} days behind` : s.daysAheadBehind > 0 ? `${s.daysAheadBehind} days ahead` : "On plan"}
              tone={s.daysAheadBehind !== null && s.daysAheadBehind < 0 ? (data.project.plannedEndDate && s.forecastFinish > data.project.plannedEndDate ? "red" : "amber") : "green"} />
            <Kpi label="Forecast finish" value={fmtDate(s.forecastFinish)} note={`Baseline ${fmtDate(data.baseline.plannedFinish)}${data.project.plannedEndDate ? ` · contract ${fmtDate(data.project.plannedEndDate)}` : ""}`}
              tone={data.project.plannedEndDate && s.forecastFinish > data.project.plannedEndDate ? "red" : undefined} />
            <Kpi label="Activities" value={`${s.counts.done} done · ${s.counts.inProgress} running`} note={`${s.counts.lateStart} late start · ${s.counts.lateFinish} late finish · ${s.counts.behind} behind`} />
            <Kpi label="Last progress update" value={fmtDate(s.lastUpdate)} tone={!s.lastUpdate ? "amber" : undefined} />
          </div>
          <Card title="S-curve: planned vs actual">
            <SCurve points={data.curve} today={data.today} />
            <p className="muted small">Baseline "{data.baseline.name}" ({data.baseline.source === "p6_xer" ? "P6 XER" : "CSV"}{data.baseline.fileName ? `, ${data.baseline.fileName}` : ""}), {data.baseline.activityCount} activities, imported {fmtDate(data.baseline.importedAt)} by {data.baseline.importedByName}.
              Planned % spreads each activity evenly over its days, weighted by duration; P6's own curve may differ slightly.</p>
          </Card>

          {editing && (
            <div className="notice ok measure-bar">
              <label>Progress as at <input type="date" value={asOf} max={todayDubai()} onChange={(e) => setAsOf(e.target.value)} /></label>
              <span>{changed.length} activit{changed.length === 1 ? "y" : "ies"} changed. Typing a % fills the actual start (and finish at 100%) with this date; change them if different.</span>
              <div className="actions"><button className="btn primary small" disabled={!changed.length} onClick={save}>Save progress</button><button className="btn secondary small" onClick={() => setEditing(false)}>Cancel</button></div>
            </div>
          )}
          {result && !result.ok && <div className="notice warn"><strong>Nothing was saved. Please correct:</strong><ul>{result.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul></div>}
          {result?.ok && <div className="notice ok">Saved progress on {result.saved} activit{result.saved === 1 ? "y" : "ies"}{result.unchanged ? ` (${result.unchanged} unchanged)` : ""}.</div>}

          <Card>
            <div className="filters">
              {!editing && (
                <div className="seg" role="tablist">
                  {([["attention", `Needs attention (${data.activities.filter((a) => a.lateStart || a.lateFinish || a.behind).length})`], ["short", "Next 2 weeks"], ["long", "Next 6 weeks"], ["all", `All (${data.activities.length})`]] as [View, string][]).map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>
                  ))}
                </div>
              )}
              <input placeholder="Search activity ID, name or WBS" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {!list.length ? <Empty>{view === "attention" ? "No activity is late or behind." : "No activities."}</Empty> : (
              <div className="table-wrap"><table className="programme">
                <thead><tr><th>Activity</th><th>Planned</th><th className="num">Plan %</th><th className="num">Actual %</th><th>Actual start</th><th>Actual finish</th><th>Status</th><th>{editing ? "Remark" : "Last update"}</th></tr></thead>
                <tbody>{list.map((a) => {
                  const [label, tone] = STATE_BADGE(a);
                  const r = rows[a.code];
                  return (
                    <tr key={a.code}>
                      <td><strong>{a.code}</strong> {a.name}{a.isMilestone && <span className="badge blue">milestone</span>}{a.wbsName || a.wbsCode ? <div className="muted small">{a.wbsName ?? a.wbsCode}</div> : null}</td>
                      <td className="small nowrap">{fmtDate(a.plannedStart)}{a.isMilestone ? "" : <><br />→ {fmtDate(a.plannedFinish)}</>}</td>
                      <td className="num">{a.plannedPct}%</td>
                      {editing && r ? (<>
                        <td className="num"><input className="pct-input" inputMode="decimal" aria-label={`% complete ${a.code}`} value={r.pct} onChange={(e) => setRow(a.code, { pct: e.target.value })} /></td>
                        <td><input type="date" aria-label={`Actual start ${a.code}`} value={r.actualStart} max={asOf} onChange={(e) => setRow(a.code, { actualStart: e.target.value })} /></td>
                        <td><input type="date" aria-label={`Actual finish ${a.code}`} value={r.actualFinish} max={asOf} onChange={(e) => setRow(a.code, { actualFinish: e.target.value })} /></td>
                        <td><span className={`badge ${tone}`}>{label}</span></td>
                        <td><input aria-label={`Remark ${a.code}`} value={r.remark} placeholder={a.remark ?? ""} onChange={(e) => setRow(a.code, { remark: e.target.value })} /></td>
                      </>) : (<>
                        <td className="num"><button className="linklike" title="Progress history" onClick={() => showHistory(a)}>{a.pct}%</button>
                          <div className="bar"><span style={{ width: `${Math.min(100, a.pct)}%` }} /><i style={{ left: `${Math.min(100, a.plannedPct)}%` }} /></div></td>
                        <td className="small">{fmtDate(a.actualStart)}</td><td className="small">{fmtDate(a.actualFinish)}</td>
                        <td><span className={`badge ${tone}`}>{label}</span></td>
                        <td className="small">{a.lastUpdate ? <>{fmtDate(a.lastUpdate.asOfDate)} · {a.lastUpdate.byName}</> : <span className="muted">never</span>}{a.remark && <div className="muted">{a.remark}</div>}</td>
                      </>)}
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}
          </Card>

          {history && (
            <Card title={<>History of {history.a.code} {history.a.name}</>} actions={<button className="btn secondary small" onClick={() => setHistory(null)}>Close</button>}>
              {!history.rows.length ? <Empty>No progress recorded yet.</Empty> : (
                <table><thead><tr><th>As at</th><th className="num">%</th><th>Actual start</th><th>Actual finish</th><th>By</th><th>Remark</th></tr></thead>
                  <tbody>{history.rows.map((h, i) => <tr key={i}><td>{fmtDate(h.asOfDate)}</td><td className="num">{Number(h.pctComplete)}%</td><td>{fmtDate(h.actualStart)}</td><td>{fmtDate(h.actualFinish)}</td><td>{h.byName}</td><td>{h.remark ?? ""}</td></tr>)}</tbody></table>
              )}
            </Card>
          )}

          <Card title="Excel and P6">
            <div className="actions">
              {can("site.progress") && <button className="btn secondary small" onClick={() => setImporting(importing === "progress" ? null : "progress")}>Import progress from Excel</button>}
              {can("programme.manage") && <button className="btn secondary small" onClick={() => setImporting(importing === "baseline" ? null : "baseline")}>Import new baseline / revised programme</button>}
            </div>
            {importing === "progress" && <ProgressImport projectId={projectId} onDone={() => { setImporting(null); reload(); }} />}
            <p className="muted small">"Export to Excel" gives the progress sheet (activity ID, % complete, actual dates, remarks) for the planner to update P6, or for a site engineer who prefers Excel; the same sheet can be imported back.</p>
            {data.baselines.length > 1 && (
              <table><thead><tr><th>Baseline</th><th>Planned</th><th className="num">Activities</th><th>Imported</th></tr></thead>
                <tbody>{data.baselines.map((b) => <tr key={b.id}><td>{b.name}{b.isCurrent && <span className="badge green">current</span>}</td><td className="small">{fmtDate(b.plannedStart)} → {fmtDate(b.plannedFinish)}</td><td className="num">{b.activityCount}</td><td className="small">{fmtDate(b.importedAt)} · {b.importedByName}</td></tr>)}</tbody></table>
            )}
          </Card>
        </>)}
      </>)}
    </Page>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: "red" | "amber" | "green" }) {
  return <div className={`kpi ${tone ? `kpi-${tone}` : ""}`}><div className="muted small">{label}</div><div className="kpi-value">{value}</div>{note && <div className="muted small">{note}</div>}</div>;
}

/** Planned (dashed) and actual (solid) % complete over time, with today marked. */
export function SCurve({ points, today }: { points: { date: string; planned: number; actual: number | null }[]; today: string }) {
  if (points.length < 2) return <Empty>Not enough dates to draw the curve.</Empty>;
  const W = 640, H = 240, L = 40, R = 12, T = 12, B = 28;
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date);
  const x = (d: string) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const line = (vals: [string, number][]) => vals.map(([d, v], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const actual = points.filter((p) => p.actual !== null).map((p) => [p.date, p.actual!] as [string, number]);
  const lastA = actual[actual.length - 1];
  const todayIn = today >= points[0].date && today <= points[points.length - 1].date;
  return (
    <figure className="scurve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="S-curve of planned and actual percent complete">
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{v}%</text></g>)}
        <text x={L} y={H - 8}>{points[0].date}</text>
        <text x={W - R} y={H - 8} textAnchor="end">{points[points.length - 1].date}</text>
        {todayIn && <g><line x1={x(today)} x2={x(today)} y1={T} y2={H - B} className="today" /><text x={x(today)} y={H - 8} textAnchor="middle" className="today-label">today</text></g>}
        <path d={line(points.map((p) => [p.date, p.planned]))} className="planned" />
        {actual.length > 0 && <path d={line(actual)} className="actual" />}
        {lastA && <circle cx={x(lastA[0])} cy={y(lastA[1])} r={4} className="actual-dot" />}
      </svg>
      <figcaption className="legend"><span className="key planned" /> Planned (baseline) <span className="key actual" /> Actual (site progress)</figcaption>
    </figure>
  );
}

interface BaselineResult { ok: boolean; saved: boolean; problems: string[]; warnings: string[]; activities: number; milestones: number; skipped: number; plannedStart: string | null; plannedFinish: string | null; p6ProjectCode: string | null; dataDate: string | null }

function BaselineImport({ projectId, hasBaseline, onDone, onCancel }: { projectId: string; hasBaseline: boolean; onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string; format: "xer" | "csv" } | null>(null);
  const [name, setName] = useState(hasBaseline ? "Revised programme" : "Baseline rev 0");
  const [res, setRes] = useState<BaselineResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean, f = file) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<BaselineResult>(`/api/projects/${projectId}/programme/baselines`, { format: f.format, text: f.text, fileName: f.name, name, dryRun });
      setRes(r);
      if (r.saved) onDone();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Card title={hasBaseline ? "Import a new baseline (e.g. revised programme after an extension of time)" : "Import the programme baseline"} actions={<button className="btn secondary small" onClick={onCancel}>Close</button>}>
      <p className="small"><strong>From P6:</strong> File → Export → Primavera PM (XER), one project. <strong>Or from Excel:</strong> an activity list with the columns <em>Activity ID, Activity Name, Start, Finish</em> (P6 column names such as <em>Planned Start, BL Project Start, Original Duration, WBS Code, Activity Type</em> are recognised), saved as CSV.</p>
      <div className="form-grid">
        <Field label="Baseline name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="File (.xer or .csv)"><input type="file" accept=".xer,.csv,text/csv" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const nf = { name: f.name, text: await readTextFile(f), format: (f.name.toLowerCase().endsWith(".xer") ? "xer" : "csv") as "xer" | "csv" };
          setFile(nf); setRes(null); await run(true, nf);
        }} /></Field>
      </div>
      {busy && <Loading what="Reading the programme" />}
      {res && !res.saved && (res.ok ? (
        <div className="notice ok">
          {res.activities} activities ({res.milestones} milestones{res.skipped ? `; ${res.skipped} level-of-effort/WBS summary skipped` : ""}), {res.plannedStart} → {res.plannedFinish}
          {res.p6ProjectCode ? ` · P6 project ${res.p6ProjectCode}` : ""}{res.dataDate ? ` · data date ${res.dataDate}` : ""}.
          {res.warnings.map((w) => <div key={w}>{w}</div>)}
          <div className="actions"><button className="btn primary small" disabled={busy || !name.trim()} onClick={() => run(false)}>{hasBaseline ? "Make this the current baseline" : "Save baseline"}</button></div>
        </div>
      ) : <div className="notice warn"><strong>Not imported:</strong><ul>{res.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul></div>)}
      <ErrorBox error={err} />
    </Card>
  );
}

function ProgressImport({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [asOf, setAsOf] = useState(todayDubai());
  const [res, setRes] = useState<SaveResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="progress-form">
      <p className="small">Use the exported sheet (or any sheet with <em>Activity ID</em> and <em>% Complete</em>, plus <em>Actual Start</em>, <em>Actual Finish</em>, <em>Remarks</em>), saved as CSV. Nothing is saved if any row has a problem.</p>
      <div className="form-grid">
        <Field label="Progress as at"><input type="date" value={asOf} max={todayDubai()} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Field label="File (.csv)"><input type="file" accept=".csv,text/csv" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          setErr(null); setRes(null);
          try { const r = await post<SaveResult>(`/api/projects/${projectId}/programme/progress/import`, { asOfDate: asOf, csv: await readTextFile(f) }); setRes(r); if (r.ok) onDone(); } catch (x) { setErr(x as ApiError); }
        }} /></Field>
      </div>
      {res && !res.ok && <div className="notice warn"><strong>Nothing was saved:</strong><ul>{res.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul></div>}
      <ErrorBox error={err} />
    </div>
  );
}
