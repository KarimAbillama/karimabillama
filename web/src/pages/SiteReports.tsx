import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, post, put, useApi, type ApiError } from "../api";
import { ActionButton, Card, Empty, ErrorBox, Field, Loading, Page, Status, addDays, fmtDate, fmtDateTime, todayDubai, useApp } from "../ui";
import { History } from "./History";

const DELAY_LABEL: Record<string, string> = {
  consultant: "Consultant (approval / inspection)", client: "Client", subcontractor: "Subcontractor", material: "Material not available", labour: "Labour shortage",
  equipment: "Equipment", weather: "Weather / heat", authority: "Authority / permit", other: "Other",
};
const TRADES = ["Mason", "Carpenter", "Steel fixer", "Plasterer", "Painter", "Tiler", "Electrician", "Plumber", "Pipe fitter", "Duct fabricator", "Landscaper", "Welder", "Operator", "Helper", "Engineer / supervisor"];

interface Row { id: string; projectId: string; projectCode: string; siteName: string | null; reportDate: string; status: string; headcount: number; delayCause: string | null; safetyIncidents: number; authorName: string; summary: string }
interface Detail {
  id: string; projectId: string; projectCode: string; projectName: string; siteId: string | null; siteName: string | null; reportDate: string; status: string; version: number;
  weather: string | null; workDone: string; issues: string | null; delayCause: string | null; inspections: string | null; visitors: string | null; safetyIncidents: number; safetyNotes: string | null;
  createdBy: string; authorName: string; submittedAt: string | null; reviewerName: string | null; reviewedAt: string | null; reviewComment: string | null;
  manpower: { id: string; trade: string; companyId: string | null; companyName: string | null; headcount: number }[]; totalHeadcount: number;
}

export function SiteReportList() {
  const { ref, projectId: selected, can } = useApp();
  const [search] = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("project") ?? selected ?? "");
  const [from, setFrom] = useState(addDays(todayDubai(), -14));
  const qs = new URLSearchParams({ from, ...(projectId ? { projectId } : {}) });
  const { data, error, loading } = useApi<Row[]>(`/api/site-reports?${qs}`);
  return (
    <Page title="Daily site reports" subtitle="What happened on each site, every day: people, work done, delays, inspections and safety."
      actions={can("sitereport.create") && <Link className="btn primary" to={`/site-reports/new${projectId ? `?project=${projectId}` : ""}`}>Write today's report</Link>}>
      <div className="filters">
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All my projects</option>
          {ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
        <label className="field inline"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No reports in this period.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Project</th><th>Status</th><th className="num">People</th><th>Work done</th><th>Delay</th><th>Safety</th><th>By</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className={r.safetyIncidents ? "late" : ""}>
                <td><Link to={`/site-reports/${r.id}`}>{fmtDate(r.reportDate)}</Link></td>
                <td>{r.projectCode}{r.siteName ? <div className="muted small">{r.siteName}</div> : null}</td>
                <td><Status value={r.status} /></td><td className="num">{r.headcount}</td>
                <td className="small">{r.summary}</td>
                <td>{r.delayCause ? <span className="badge amber">{r.delayCause}</span> : "—"}</td>
                <td>{r.safetyIncidents ? <span className="badge red">{r.safetyIncidents} incident</span> : "—"}</td>
                <td>{r.authorName}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

interface Crew { trade: string; companyId: string; headcount: string }

export function SiteReportForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { ref, projectId: selected } = useApp();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(search.get("project") ?? selected ?? ref.projects[0]?.id ?? "");
  const [siteId, setSiteId] = useState("");
  const [reportDate, setDate] = useState(search.get("date") ?? todayDubai());
  const [weather, setWeather] = useState("");
  const [workDone, setWork] = useState("");
  const [issues, setIssues] = useState("");
  const [delayCause, setDelay] = useState("");
  const [inspections, setInspections] = useState("");
  const [visitors, setVisitors] = useState("");
  const [safetyIncidents, setIncidents] = useState("0");
  const [safetyNotes, setSafetyNotes] = useState("");
  const [crew, setCrew] = useState<Crew[]>([{ trade: "", companyId: "", headcount: "" }]);
  const [version, setVersion] = useState<number>();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const sites = ref.sites.filter((s) => s.projectId === projectId);
  useEffect(() => { if (!id && sites.length === 1) setSiteId(sites[0].id); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!id) return;
    get<Detail>(`/api/site-reports/${id}`).then((d) => {
      setProjectId(d.projectId); setSiteId(d.siteId ?? ""); setDate(d.reportDate); setWeather(d.weather ?? ""); setWork(d.workDone); setIssues(d.issues ?? "");
      setDelay(d.delayCause ?? ""); setInspections(d.inspections ?? ""); setVisitors(d.visitors ?? ""); setIncidents(String(d.safetyIncidents)); setSafetyNotes(d.safetyNotes ?? "");
      setCrew(d.manpower.length ? d.manpower.map((m) => ({ trade: m.trade, companyId: m.companyId ?? "", headcount: String(m.headcount) })) : [{ trade: "", companyId: "", headcount: "" }]);
      setVersion(d.version);
    }).catch(setErr);
  }, [id]);
  const total = crew.reduce((a, c) => a + (Number(c.headcount) || 0), 0);
  const setRow = (i: number, patch: Partial<Crew>) => setCrew(crew.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = async (submit: boolean) => {
    setBusy(true); setErr(null);
    try {
      const body = {
        siteId: siteId || null, weather: weather || null, workDone, issues: issues || null, delayCause: delayCause || null, inspections: inspections || null, visitors: visitors || null,
        safetyIncidents: Number(safetyIncidents) || 0, safetyNotes: safetyNotes || null,
        manpower: crew.filter((c) => c.trade && Number(c.headcount) > 0).map((c) => ({ trade: c.trade, companyId: c.companyId || null, headcount: Number(c.headcount) })),
      };
      const saved = id ? await put<{ id: string; version: number }>(`/api/site-reports/${id}`, { ...body, version }) : await post<{ id: string; version: number }>("/api/site-reports", { ...body, projectId, reportDate });
      if (submit) await post(`/api/site-reports/${saved.id}/submit`, { version: saved.version });
      navigate(`/site-reports/${saved.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Page title={id ? "Edit daily report" : "Daily site report"} back={id ? `/site-reports/${id}` : "/site-reports"}>
      <Card>
        <div className="form-grid">
          <Field label="Project"><select value={projectId} disabled={!!id} onChange={(e) => { setProjectId(e.target.value); setSiteId(""); }}>{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Site"><select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Whole project</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={reportDate} disabled={!!id} max={todayDubai()} min={addDays(todayDubai(), -7)} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Weather"><input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. Clear, 38 °C" /></Field>
        </div>
      </Card>
      <Card title={`People on site (${total})`} actions={<button className="btn secondary small" onClick={() => setCrew([...crew, { trade: "", companyId: "", headcount: "" }])}>Add trade</button>}>
        <datalist id="trades">{TRADES.map((t) => <option key={t} value={t} />)}</datalist>
        <div className="line-editor">
          {crew.map((c, i) => (
            <div key={i} className="crew-row">
              <Field label="Trade"><input list="trades" value={c.trade} onChange={(e) => setRow(i, { trade: e.target.value })} /></Field>
              <Field label="Company"><select value={c.companyId} onChange={(e) => setRow(i, { companyId: e.target.value })}><option value="">EDGE (own staff)</option>{ref.partners.filter((p) => p.isSubcontractor).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Number"><input inputMode="numeric" value={c.headcount} onChange={(e) => setRow(i, { headcount: e.target.value.replace(/\D/g, "") })} /></Field>
              {crew.length > 1 && <button className="btn secondary small" aria-label="Remove trade" onClick={() => setCrew(crew.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
        </div>
      </Card>
      <Card title="The day">
        <Field label="Work done today"><textarea rows={3} value={workDone} onChange={(e) => setWork(e.target.value)} placeholder="Areas and activities, e.g. Blockwork L9 corridors; MEP first fix L4–5" /></Field>
        <div className="form-grid">
          <Field label="Was work held up?"><select value={delayCause} onChange={(e) => setDelay(e.target.value)}><option value="">No</option>{Object.entries(DELAY_LABEL).map(([k, v]) => <option key={k} value={k}>Yes: {v}</option>)}</select></Field>
          <Field label="Inspections (consultant / authority)"><input value={inspections} onChange={(e) => setInspections(e.target.value)} placeholder="e.g. Blockwork L8 inspected, passed" /></Field>
          <Field label="Visitors"><input value={visitors} onChange={(e) => setVisitors(e.target.value)} /></Field>
        </div>
        <Field label={delayCause ? "What held the work up (required)" : "Problems / issues"}><textarea rows={2} value={issues} onChange={(e) => setIssues(e.target.value)} /></Field>
        <div className="form-grid">
          <Field label="Safety incidents"><input inputMode="numeric" value={safetyIncidents} onChange={(e) => setIncidents(e.target.value.replace(/\D/g, ""))} /></Field>
          {Number(safetyIncidents) > 0 && <Field label="What happened (required)"><input value={safetyNotes} onChange={(e) => setSafetyNotes(e.target.value)} /></Field>}
        </div>
      </Card>
      <p className="muted small">Photos come with the file-storage step. For now, keep site photos where you keep them today.</p>
      <ErrorBox error={err} />
      <div className="actions sticky-actions">
        <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={busy || !workDone.trim()} onClick={() => save(true)}>{busy ? "Saving…" : "Submit to project manager"}</button>
      </div>
    </Page>
  );
}

export function SiteReportDetail() {
  const { id } = useParams();
  const { me, can } = useApp();
  const { data: d, error, loading, reload } = useApi<Detail>(`/api/site-reports/${id}`);
  const [comment, setComment] = useState("");
  if (loading && !d) return <Loading />;
  if (error || !d) return <Page title="Daily report" back="/site-reports"><ErrorBox error={error} /></Page>;
  const editable = ["draft", "returned"].includes(d.status) && can("sitereport.create");
  return (
    <Page title={<>Daily report {fmtDate(d.reportDate)} <Status value={d.status} /></>} subtitle={`${d.projectCode} — ${d.projectName}${d.siteName ? ` · ${d.siteName}` : ""} · by ${d.authorName}`} back="/site-reports"
      actions={editable && <>
        <Link className="btn secondary" to={`/site-reports/${d.id}/edit`}>Edit</Link>
        <ActionButton onClick={async () => { await post(`/api/site-reports/${d.id}/submit`, { version: d.version }); reload(); }}>Submit</ActionButton>
      </>}>
      {d.status === "returned" && <div className="notice warn">Returned by {d.reviewerName}: {d.reviewComment}</div>}
      {d.status === "submitted" && can("sitereport.review") && d.createdBy !== me.userId && (
        <Card title="Your review" className="decision">
          <label className="field"><span>Comment (required to return)</span><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="actions">
            <ActionButton onClick={async () => { await post(`/api/site-reports/${d.id}/review`, { decision: "accept", comment: comment || null }); reload(); }}>Accept</ActionButton>
            <ActionButton kind="danger" onClick={async () => { await post(`/api/site-reports/${d.id}/review`, { decision: "return", comment }); reload(); }}>Return for correction</ActionButton>
          </div>
        </Card>
      )}
      <div className="report-grid">
        <Card title={`People on site: ${d.totalHeadcount}`}>
          {!d.manpower.length ? <Empty>No manpower recorded.</Empty> : (
            <table><tbody>{d.manpower.map((m) => <tr key={m.id}><td>{m.trade}</td><td className="muted">{m.companyName ?? "EDGE"}</td><td className="num">{m.headcount}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="The day">
          <dl className="meta">
            <dt>Weather</dt><dd>{d.weather ?? "—"}</dd>
            <dt>Work done</dt><dd className="pre">{d.workDone || "—"}</dd>
            <dt>Held up?</dt><dd>{d.delayCause ? <span className="badge amber">{DELAY_LABEL[d.delayCause]}</span> : "No"}</dd>
            <dt>Issues</dt><dd className="pre">{d.issues ?? "—"}</dd>
            <dt>Inspections</dt><dd>{d.inspections ?? "—"}</dd>
            <dt>Visitors</dt><dd>{d.visitors ?? "—"}</dd>
            <dt>Safety</dt><dd>{d.safetyIncidents ? <><span className="badge red">{d.safetyIncidents} incident</span> {d.safetyNotes}</> : "No incidents"}</dd>
          </dl>
        </Card>
      </div>
      <p className="muted small">Submitted {fmtDateTime(d.submittedAt)}{d.reviewedAt ? ` · reviewed by ${d.reviewerName} ${fmtDateTime(d.reviewedAt)}` : ""}</p>
      <History type="site_report" id={d.id} />
    </Page>
  );
}
