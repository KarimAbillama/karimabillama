import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { post, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Field, Loading, Page, Status, fmtDate, fmtDateTime, todayDubai, useApp } from "../ui";
import { History } from "./History";

const DISCIPLINES = ["architectural", "structural", "civil", "mechanical", "electrical", "plumbing", "fire", "landscape", "other"];
const PURPOSE_LABEL: Record<string, string> = { tender: "Tender", for_information: "For information", for_approval: "For approval", for_construction: "For construction", as_built: "As built" };
const STATE_LABEL: Record<string, [string, string]> = { current_construction: ["Current for construction", "green"], latest: ["Latest (not for construction)", "amber"], superseded: ["Superseded", "grey"] };

interface Row { id: string; projectCode: string; number: string; title: string; discipline: string; revisions: number; latest: { revision: string; issueDate: string; purpose: string } | null; construction: { revision: string; issueDate: string; fileRef: string | null } | null }
interface Detail {
  id: string; projectId: string; projectCode: string; projectName: string; number: string; title: string; discipline: string;
  revisions: { id: string; revision: string; issueDate: string; purpose: string; state: string; transmittalRef: string | null; fileRef: string | null; distribution: string | null; notes: string | null; recordedByName: string; recordedAt: string }[];
  rfis: { id: string; number: string; subject: string; status: string; revision: string | null }[];
}

export function DrawingList() {
  const { ref, projectId: selected, can } = useApp();
  const [search] = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("project") ?? selected ?? "");
  const [discipline, setDiscipline] = useState("");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(discipline ? { discipline } : {}), ...(q ? { q } : {}) });
  const { data, error, loading } = useApi<Row[]>(`/api/drawings?${qs}`);
  return (
    <Page title="Drawing register" subtitle="Every drawing with all its revisions. Build only from the revision marked current for construction."
      actions={can("drawing.manage") && <Link className="btn primary" to={`/drawings/new${projectId ? `?project=${projectId}` : ""}`}>Register drawing</Link>}>
      <div className="filters">
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All my projects</option>{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
        <select aria-label="Discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value)}><option value="">All disciplines</option>{DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <input placeholder="Search number or title" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No drawings registered yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Drawing</th><th>Project</th><th>Title</th><th>Build from</th><th>Latest issue</th><th className="num">Revisions</th></tr></thead>
            <tbody>{data.map((d) => {
              const newer = d.latest && d.construction && d.latest.revision !== d.construction.revision;
              return (
                <tr key={d.id}>
                  <td><Link to={`/drawings/${d.id}`}>{d.number}</Link><div className="muted small">{d.discipline}</div></td><td>{d.projectCode}</td><td>{d.title}</td>
                  <td>{d.construction ? <><span className="badge green">Rev {d.construction.revision}</span> <span className="muted small">{fmtDate(d.construction.issueDate)}</span></> : <span className="badge amber">No construction issue</span>}</td>
                  <td>{d.latest ? <>{d.latest.revision} · {PURPOSE_LABEL[d.latest.purpose]}{newer ? <span className="badge amber">newer than construction set</span> : null}</> : "—"}</td>
                  <td className="num">{d.revisions}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

function RevisionFields({ v, set }: { v: Record<string, string>; set: (k: string, val: string) => void }) {
  return (
    <div className="form-grid">
      <Field label="Revision"><input value={v.revision} onChange={(e) => set("revision", e.target.value)} placeholder="e.g. C03" /></Field>
      <Field label="Issue date"><input type="date" value={v.issueDate} max={todayDubai()} onChange={(e) => set("issueDate", e.target.value)} /></Field>
      <Field label="Purpose"><select value={v.purpose} onChange={(e) => set("purpose", e.target.value)}>{Object.entries(PURPOSE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Transmittal no."><input value={v.transmittalRef} onChange={(e) => set("transmittalRef", e.target.value)} /></Field>
      <Field label="File location" hint="Path of the PDF on your server, e.g. \\server\drawings\..."><input value={v.fileRef} onChange={(e) => set("fileRef", e.target.value)} /></Field>
      <Field label="Issued to"><input value={v.distribution} onChange={(e) => set("distribution", e.target.value)} placeholder="e.g. Site team, MEP subcontractor" /></Field>
    </div>
  );
}
const emptyRev = () => ({ revision: "", issueDate: todayDubai(), purpose: "for_construction", transmittalRef: "", fileRef: "", distribution: "", notes: "" });
const revBody = (v: Record<string, string>) => ({ revision: v.revision, issueDate: v.issueDate, purpose: v.purpose, transmittalRef: v.transmittalRef || null, fileRef: v.fileRef || null, distribution: v.distribution || null, notes: v.notes || null });

export function DrawingForm() {
  const [search] = useSearchParams();
  const { ref, projectId: selected } = useApp();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(search.get("project") ?? selected ?? ref.projects[0]?.id ?? "");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [discipline, setDiscipline] = useState("architectural");
  const [rev, setRev] = useState<Record<string, string>>(emptyRev());
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await post<{ id: string }>("/api/drawings", { projectId, number, title, discipline, firstRevision: revBody(rev) });
      navigate(`/drawings/${d.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Page title="Register a drawing" back="/drawings">
      <Card>
        <div className="form-grid">
          <Field label="Project"><select value={projectId} onChange={(e) => setProjectId(e.target.value)}>{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Drawing number"><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. ARC-L02-201" /></Field>
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Discipline"><select value={discipline} onChange={(e) => setDiscipline(e.target.value)}>{DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
        </div>
      </Card>
      <Card title="First revision"><RevisionFields v={rev} set={(k, val) => setRev({ ...rev, [k]: val })} /></Card>
      <ErrorBox error={err} />
      <div className="actions sticky-actions"><button className="btn primary" disabled={busy || !number.trim() || !title.trim() || !rev.revision.trim()} onClick={save}>{busy ? "Saving…" : "Register"}</button></div>
    </Page>
  );
}

export function DrawingDetail() {
  const { id } = useParams();
  const { can } = useApp();
  const { data: d, error, loading, reload } = useApi<Detail>(`/api/drawings/${id}`);
  const [adding, setAdding] = useState(false);
  const [rev, setRev] = useState<Record<string, string>>(emptyRev());
  const [err, setErr] = useState<ApiError | null>(null);
  if (loading && !d) return <Loading />;
  if (error || !d) return <Page title="Drawing" back="/drawings"><ErrorBox error={error} /></Page>;
  const current = d.revisions.find((r) => r.state === "current_construction");
  return (
    <Page title={<>{d.number} {current ? <span className="badge green">Build from rev {current.revision}</span> : <span className="badge amber">No construction issue</span>}</>}
      subtitle={`${d.projectCode} · ${d.title} · ${d.discipline}`} back="/drawings"
      actions={can("drawing.manage") && !adding && <button className="btn primary" onClick={() => { setRev(emptyRev()); setAdding(true); }}>Record new revision</button>}>
      {adding && (
        <Card title="New revision" className="highlight">
          <RevisionFields v={rev} set={(k, val) => setRev({ ...rev, [k]: val })} />
          <ErrorBox error={err} />
          <div className="actions">
            <button className="btn primary" disabled={!rev.revision.trim()} onClick={async () => { try { await post(`/api/drawings/${d.id}/revisions`, revBody(rev)); setAdding(false); setErr(null); reload(); } catch (e) { setErr(e as ApiError); } }}>Save revision</button>
            <button className="btn secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </Card>
      )}
      <Card title="Revisions (newest first, none are ever deleted)">
        <div className="table-wrap"><table>
          <thead><tr><th>Rev</th><th>State</th><th>Purpose</th><th>Issued</th><th>Transmittal</th><th>File</th><th>Issued to</th><th>Recorded</th></tr></thead>
          <tbody>{d.revisions.map((r) => (
            <tr key={r.id} className={r.state === "superseded" ? "dim" : ""}>
              <td><strong>{r.revision}</strong></td><td><span className={`badge ${STATE_LABEL[r.state][1]}`}>{STATE_LABEL[r.state][0]}</span></td><td>{PURPOSE_LABEL[r.purpose]}</td>
              <td>{fmtDate(r.issueDate)}</td><td>{r.transmittalRef ?? "—"}</td><td className="small mono">{r.fileRef ?? "—"}</td><td className="small">{r.distribution ?? "—"}</td>
              <td className="small">{r.recordedByName}<div className="muted">{fmtDateTime(r.recordedAt)}</div></td>
            </tr>))}
          </tbody>
        </table></div>
      </Card>
      <Card title="RFIs about this drawing">
        {!d.rfis.length ? <Empty>None.</Empty> : (
          <ul className="history">{d.rfis.map((r) => <li key={r.id}><Link to={`/rfis/${r.id}`}>{r.number}</Link> · rev {r.revision} · {r.subject} <Status value={r.status} /></li>)}</ul>
        )}
      </Card>
      <History type="drawing" id={d.id} />
    </Page>
  );
}
