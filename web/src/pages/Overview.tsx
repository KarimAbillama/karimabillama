import { useState } from "react";
import { Link } from "react-router-dom";
import { post, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Field, Loading, Page, fmtDate, fmtMoney, todayDubai, useApp } from "../ui";

type Rag = "red" | "amber" | "green" | "none";
interface ProjectRow {
  project: { id: string; code: string; name: string; status: string; clientName: string | null; startDate: string | null; plannedEndDate: string | null };
  overall: Rag;
  programme: { asOf: string; plannedPct: string; actualPct: string; variancePct: string; forecastEndDate: string | null; plannedEndDate: string | null; lateFinish: boolean; stale: boolean; summary: string | null; risks: string | null; rag: Rag } | null;
  approvals: { total: number; withConsultant: number; overdue: number; maxOverdueDays: number; toResubmit: number; lateForSite: number; approved: number; rag: Rag } | null;
  site: { lastReportDate: string | null; missingWorkdays: number; headcount: number; delayDays: number; delayCauses: string[]; rag: Rag };
  safety: { incidents: number; rag: Rag };
  supply: { lateDeliveries: number; worstLateDays: number; uncoveredSoon: number; rag: Rag };
  money: { contractValue: string | null; committed: string; issuedCost: string; notTracked: string[] } | null;
  attention: string[];
}
interface OverviewData {
  today: string; expectedReportDay: string;
  totals: { projects: number; red: number; amber: number; headcount: number; submittalsWithConsultant: number; submittalsOverdue: number; myApprovals: number };
  projects: ProjectRow[];
}

const RAG_LABEL: Record<Rag, string> = { red: "Action needed", amber: "Watch", green: "On track", none: "No data" };
const pct = (v: string) => `${Number(v).toLocaleString("en-AE", { maximumFractionDigits: 1 })}%`;

function Chip({ rag, label, children, to }: { rag: Rag; label: string; children: React.ReactNode; to?: string }) {
  const body = (<><span className="chip-label">{label}</span><span className="chip-text">{children}</span></>);
  return to ? <Link to={to} className={`chip rag-${rag}`}>{body}</Link> : <div className={`chip rag-${rag}`}>{body}</div>;
}

/** The owner's view of every project: one row each, worst first, with what needs attention. */
export function Overview() {
  const { can } = useApp();
  const { data, error, loading, reload } = useApi<OverviewData>("/api/overview");
  const [updating, setUpdating] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  return (
    <Page title="All projects" subtitle={data ? `Today in Dubai: ${data.today} · worst first · built from site reports, submittals, progress updates and purchasing` : undefined}>
      <ErrorBox error={error} />
      {data && (<>
        <div className="totals-strip">
          <div><strong>{data.totals.projects}</strong><span>projects</span></div>
          <div className={data.totals.red ? "t-red" : ""}><strong>{data.totals.red}</strong><span>need action</span></div>
          <div className={data.totals.amber ? "t-amber" : ""}><strong>{data.totals.amber}</strong><span>to watch</span></div>
          <div><strong>{data.totals.headcount}</strong><span>people on site (latest reports)</span></div>
          {can("submittal.view") && <Link to="/submittals?ball=consultant"><strong>{data.totals.submittalsWithConsultant}</strong><span>submittals with consultants{data.totals.submittalsOverdue ? `, ${data.totals.submittalsOverdue} overdue` : ""}</span></Link>}
          <Link to="/approvals"><strong>{data.totals.myApprovals}</strong><span>approvals waiting for you</span></Link>
        </div>

        {!data.projects.length && <Card><Empty>No active projects you can see.</Empty></Card>}
        {data.projects.map((r) => (
          <section key={r.project.id} className={`card project-row rag-edge-${r.overall}`}>
            <div className="project-row-head">
              <div>
                <div className="project-title"><span className="tag">{r.project.code}</span> <strong>{r.project.name}</strong></div>
                <div className="muted small">{r.project.clientName ?? "—"} · planned finish {fmtDate(r.project.plannedEndDate)}{r.project.status !== "active" ? ` · ${r.project.status.replace(/_/g, " ")}` : ""}</div>
              </div>
              <span className={`rag-pill rag-${r.overall}`}>{RAG_LABEL[r.overall]}</span>
            </div>

            <div className="chips">
              <Chip rag={r.programme?.rag ?? "none"} label="Programme">
                {r.programme ? <>{pct(r.programme.actualPct)} done vs {pct(r.programme.plannedPct)} planned{r.programme.lateFinish ? ` · finish ${fmtDate(r.programme.forecastEndDate)}` : ""}</> : "No progress update yet"}
              </Chip>
              {r.approvals && (
                <Chip rag={r.approvals.rag} label="Approvals" to={`/submittals?project=${r.project.id}`}>
                  {r.approvals.total === 0 ? "No submittals yet" : <>{r.approvals.withConsultant} with consultant{r.approvals.overdue ? ` (${r.approvals.overdue} overdue)` : ""} · {r.approvals.toResubmit} to resubmit</>}
                </Chip>
              )}
              <Chip rag={r.site.rag} label="Site" to={`/site-reports?project=${r.project.id}`}>
                {r.site.lastReportDate ? <>{r.site.headcount} people · last report {fmtDate(r.site.lastReportDate)}{r.site.delayDays ? ` · ${r.site.delayDays} delay day(s)` : ""}</> : "No reports"}
              </Chip>
              <Chip rag={r.safety.rag} label="Safety">{r.safety.rag === "none" ? "No reports" : r.safety.incidents ? `${r.safety.incidents} incident(s), 30 days` : "No incidents, 30 days"}</Chip>
              <Chip rag={r.supply.rag} label="Materials" to={`/report?project=${r.project.id}`}>
                {r.supply.lateDeliveries ? `${r.supply.lateDeliveries} late deliver${r.supply.lateDeliveries > 1 ? "ies" : "y"}` : "No late deliveries"}{r.supply.uncoveredSoon ? ` · ${r.supply.uncoveredSoon} shortage(s)` : ""}
              </Chip>
            </div>

            <div className="project-row-body">
              <div className="attention">
                {r.attention.length ? <ul>{r.attention.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="muted">Nothing needs attention.</p>}
                {r.programme?.risks && <p className="small"><strong>PM's risks:</strong> {r.programme.risks}</p>}
              </div>
              <div className="money">
                {r.money ? (<>
                  <div><span className="muted small">Contract value</span><strong>{fmtMoney(r.money.contractValue)}</strong></div>
                  <div><span className="muted small">Materials committed</span><strong>{fmtMoney(r.money.committed)}</strong></div>
                  <div><span className="muted small">Materials used</span><strong>{fmtMoney(r.money.issuedCost)}</strong></div>
                  <div className="muted small">Certified, paid, variations: coming next</div>
                </>) : <div className="muted small">Money hidden for your role</div>}
              </div>
            </div>

            <div className="actions">
              <Link className="btn secondary small" to={`/site-reports?project=${r.project.id}`}>Site reports</Link>
              {can("submittal.view") && <Link className="btn secondary small" to={`/submittals?project=${r.project.id}`}>Submittals</Link>}
              <Link className="btn secondary small" to={`/report?project=${r.project.id}`}>Materials report</Link>
              {can("progress.update") && <button className="btn secondary small" onClick={() => setUpdating(updating === r.project.id ? null : r.project.id)}>Update progress</button>}
              {r.programme && <span className="muted small">Progress as at {fmtDate(r.programme.asOf)}{r.programme.stale ? " (out of date)" : ""}</span>}
            </div>
            {updating === r.project.id && <ProgressForm row={r} onDone={() => { setUpdating(null); reload(); }} />}
          </section>
        ))}
        <p className="muted small">Ratings use proposed thresholds (to be confirmed): programme amber 3 points behind, red 10 behind or late finish; submittal red when more than 7 days overdue or not approved by the date site needs it; site red after 3 working days without a report.</p>
      </>)}
    </Page>
  );
}

function ProgressForm({ row, onDone }: { row: ProjectRow; onDone: () => void }) {
  const [asOfDate, setAsOf] = useState(todayDubai());
  const [plannedPct, setPlanned] = useState(row.programme?.plannedPct ? String(Number(row.programme.plannedPct)) : "");
  const [actualPct, setActual] = useState(row.programme?.actualPct ? String(Number(row.programme.actualPct)) : "");
  const [forecastEndDate, setForecast] = useState(row.programme?.forecastEndDate ?? row.project.plannedEndDate ?? "");
  const [summary, setSummary] = useState("");
  const [risks, setRisks] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await post(`/api/projects/${row.project.id}/progress`, { asOfDate, plannedPct, actualPct, forecastEndDate: forecastEndDate || null, summary: summary || null, risks: risks || null });
      onDone();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <div className="progress-form">
      <div className="form-grid">
        <Field label="As at"><input type="date" value={asOfDate} max={todayDubai()} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Field label="Planned progress %"><input inputMode="decimal" value={plannedPct} onChange={(e) => setPlanned(e.target.value)} /></Field>
        <Field label="Actual progress %"><input inputMode="decimal" value={actualPct} onChange={(e) => setActual(e.target.value)} /></Field>
        <Field label="Forecast finish"><input type="date" value={forecastEndDate} onChange={(e) => setForecast(e.target.value)} /></Field>
      </div>
      <div className="form-grid">
        <Field label="This week in one line"><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Blockwork 2 floors behind; MEP on plan" /></Field>
        <Field label="Main risks"><input value={risks} onChange={(e) => setRisks(e.target.value)} placeholder="e.g. Tile approval needed before L6 finishes" /></Field>
      </div>
      <ErrorBox error={err} />
      <div className="actions"><button className="btn primary small" disabled={busy || !plannedPct || !actualPct} onClick={save}>{busy ? "Saving…" : "Save progress"}</button></div>
    </div>
  );
}
