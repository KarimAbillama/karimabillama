import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, post, put, useApi, type ApiError } from "../api";
import { ActionButton, Card, Empty, ErrorBox, Field, Loading, Page, Status, fmtDate, fmtDateTime, todayDubai, useApp } from "../ui";
import { History } from "./History";
import { ItemSelect, useItems } from "./MaterialRequests";

export const TYPE_LABEL: Record<string, string> = {
  shop_drawing: "Shop drawing", material: "Material submittal", sample: "Sample", mockup: "Mock-up", method_statement: "Method statement", other: "Other",
};
const DISCIPLINES = ["civil", "structural", "architectural", "mechanical", "electrical", "plumbing", "fire", "landscape", "other"];
const OUTCOME_LABEL: Record<string, string> = {
  approved: "Approved", approved_as_noted: "Approved with comments", revise_resubmit: "Revise and resubmit", rejected: "Rejected", for_information: "For information",
};

interface Row {
  id: string; number: string; projectId: string; projectCode: string; type: string; title: string; discipline: string; area: string | null; status: string;
  currentRevision: number; requiredBy: string | null; consultantName: string | null; subcontractorName: string | null; ballInCourt: "consultant" | "edge" | null;
  daysWithConsultant: number | null; dueDate: string | null; daysOverdue: number; overdue: boolean; lateForSite: boolean; lastOutcome: string | null;
}
interface Code { id: string; code: string; label: string; outcome: string }
interface Detail extends Row {
  version: number; specSection: string | null; subcontractorId: string | null; consultantId: string | null; creatorName: string | null; createdAt: string;
  items: { id: string; code: string; description: string }[]; codes: Code[];
  revisions: { id: string; revNo: number; submittedDate: string; dueDate: string; transmittalRef: string | null; notes: string | null; submittedByName: string; returnedDate: string | null;
    code: string | null; codeLabel: string | null; outcome: string | null; consultantComments: string | null; reviewerName: string | null; inspectionDate: string | null; recordedByName: string | null }[];
}

function Ball({ r }: { r: Pick<Row, "ballInCourt" | "daysWithConsultant" | "daysOverdue" | "dueDate"> }) {
  if (r.ballInCourt === "consultant") return <span className={`badge ${r.daysOverdue > 0 ? "red" : "blue"}`}>Consultant · {r.daysWithConsultant} d{r.daysOverdue > 0 ? ` · ${r.daysOverdue} d late` : ""}</span>;
  if (r.ballInCourt === "edge") return <span className="badge amber">EDGE to act</span>;
  return <span className="badge grey">Done</span>;
}

export function SubmittalList() {
  const { ref, projectId: selected, can } = useApp();
  const [search] = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("project") ?? selected ?? "");
  const [type, setType] = useState("");
  const [ball, setBall] = useState(search.get("ball") ?? "");
  const [overdue, setOverdue] = useState(false);
  const qs = new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(type ? { type } : {}), ...(ball ? { ball } : {}), ...(overdue ? { overdue: "true" } : {}) });
  const { data, error, loading } = useApi<Row[]>(`/api/submittals?${qs}`);
  return (
    <Page title="Submittals, samples & mock-ups" subtitle="Everything waiting for consultant approval, who holds it, and for how long."
      actions={can("submittal.manage") && <Link className="btn primary" to={`/submittals/new${projectId ? `?project=${projectId}` : ""}`}>New submittal</Link>}>
      <div className="filters">
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All my projects</option>
          {ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Who holds it" value={ball} onChange={(e) => setBall(e.target.value)}>
          <option value="">Anyone</option><option value="consultant">With the consultant</option><option value="edge">EDGE to act (draft or resubmit)</option>
        </select>
        <label className="check"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Late only</label>
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No submittals match these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>Project</th><th>Type</th><th>Title</th><th>Rev</th><th>Status</th><th>Who holds it</th><th>Reply due</th><th>Needed on site</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className={r.overdue || r.lateForSite ? "late" : ""}>
                <td><Link to={`/submittals/${r.id}`}>{r.number}</Link></td><td>{r.projectCode}</td><td>{TYPE_LABEL[r.type]}</td>
                <td>{r.title}<div className="muted small">{r.discipline}{r.area ? ` · ${r.area}` : ""}{r.subcontractorName ? ` · ${r.subcontractorName}` : ""}</div></td>
                <td>{r.currentRevision}</td><td><Status value={r.status} /></td><td><Ball r={r} /></td>
                <td className={r.overdue ? "warn" : ""}>{fmtDate(r.dueDate)}</td>
                <td className={r.lateForSite ? "warn" : ""}>{fmtDate(r.requiredBy)}{r.lateForSite ? " (late)" : ""}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {projectId && <CodesCard projectId={projectId} />}
    </Page>
  );
}

/** The consultant's codes for one project (each consultant uses their own). */
function CodesCard({ projectId }: { projectId: string }) {
  const { can } = useApp();
  const { data, reload } = useApi<Code[]>(`/api/projects/${projectId}/submittal-codes`);
  const [edit, setEdit] = useState<{ code: string; label: string; outcome: string }[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  if (!data) return null;
  return (
    <Card title="Consultant codes for this project" actions={can("submittal.manage") && !edit && <button className="btn secondary small" onClick={() => setEdit(data.map(({ code, label, outcome }) => ({ code, label, outcome })))}>Edit codes</button>}>
      {!edit ? (data.length ? <div className="code-list">{data.map((c) => <span key={c.id} className="code-pill"><strong>{c.code}</strong> {c.label} <span className="muted small">→ {OUTCOME_LABEL[c.outcome]}</span></span>)}</div>
        : <Empty>No codes set yet. Add the consultant's codes before recording responses.</Empty>) : (<>
        <div className="line-editor">
          {edit.map((c, i) => (
            <div key={i} className="code-row">
              <Field label="Code"><input value={c.code} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} /></Field>
              <Field label="Consultant's wording"><input value={c.label} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label="Means"><select value={c.outcome} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, outcome: e.target.value } : x)))}>
                {Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></Field>
              <button className="btn secondary small" aria-label="Remove code" onClick={() => setEdit(edit.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <ErrorBox error={err} />
        <div className="actions">
          <button className="btn secondary small" onClick={() => setEdit([...edit, { code: "", label: "", outcome: "approved" }])}>Add code</button>
          <ActionButton onClick={async () => { try { await put(`/api/projects/${projectId}/submittal-codes`, { codes: edit }); setEdit(null); setErr(null); reload(); } catch (e) { setErr(e as ApiError); } }}>Save codes</ActionButton>
          <button className="btn secondary small" onClick={() => { setEdit(null); setErr(null); }}>Cancel</button>
        </div>
      </>)}
    </Card>
  );
}

export function SubmittalForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { ref, projectId: selected } = useApp();
  const navigate = useNavigate();
  const items = useItems();
  const [f, setF] = useState({ projectId: search.get("project") ?? selected ?? ref.projects[0]?.id ?? "", type: "material", title: "", discipline: "architectural",
    specSection: "", area: "", subcontractorId: "", consultantId: "", requiredBy: "" });
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [version, setVersion] = useState<number>();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id) return;
    get<Detail>(`/api/submittals/${id}`).then((d) => {
      setF({ projectId: d.projectId, type: d.type, title: d.title, discipline: d.discipline, specSection: d.specSection ?? "", area: d.area ?? "",
        subcontractorId: d.subcontractorId ?? "", consultantId: d.consultantId ?? "", requiredBy: d.requiredBy ?? "" });
      setItemIds(d.items.map((i) => i.id)); setVersion(d.version);
    }).catch(setErr);
  }, [id]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { type: f.type, title: f.title, discipline: f.discipline, specSection: f.specSection || null, area: f.area || null, subcontractorId: f.subcontractorId || null,
        consultantId: f.consultantId || null, requiredBy: f.requiredBy || null, itemIds };
      const saved = id ? await put<{ id: string }>(`/api/submittals/${id}`, { ...body, version }) : await post<{ id: string }>("/api/submittals", { ...body, projectId: f.projectId });
      navigate(`/submittals/${saved.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Page title={id ? "Edit submittal" : "New submittal"} back={id ? `/submittals/${id}` : "/submittals"}>
      <Card>
        <div className="form-grid">
          <Field label="Project"><select value={f.projectId} disabled={!!id} onChange={set("projectId")}>{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Type"><select value={f.type} onChange={set("type")}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Title"><input value={f.title} onChange={set("title")} placeholder="e.g. Bathroom mock-up, type B" required /></Field>
          <Field label="Discipline"><select value={f.discipline} onChange={set("discipline")}>{DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
          <Field label="Spec section"><input value={f.specSection} onChange={set("specSection")} placeholder="e.g. 09 30 00" /></Field>
          <Field label="Area / location"><input value={f.area} onChange={set("area")} placeholder="e.g. Level 2, apt 204" /></Field>
          <Field label="Subcontractor"><select value={f.subcontractorId} onChange={set("subcontractorId")}><option value="">— EDGE's own</option>{ref.partners.filter((c) => c.isSubcontractor).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Consultant"><select value={f.consultantId} onChange={set("consultantId")}><option value="">Project's consultant</option>{ref.partners.filter((c) => c.isConsultant).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Approval needed by" hint="So ordering and site work are not delayed"><input type="date" value={f.requiredBy} onChange={set("requiredBy")} /></Field>
        </div>
      </Card>
      <Card title="Materials this covers" actions={<span className="muted small">A purchase order for these cannot go for approval until this is approved.</span>}>
        <div className="code-list">
          {itemIds.map((iid) => { const it = items.find((x) => x.id === iid); return <span key={iid} className="code-pill">{it?.code ?? "…"} <button className="linklike" aria-label="Remove item" onClick={() => setItemIds(itemIds.filter((x) => x !== iid))}>✕</button></span>; })}
          {!itemIds.length && <span className="muted small">None (for example a shop drawing or method statement).</span>}
        </div>
        <div className="add-item"><ItemSelect items={items} value={pick} onChange={setPick} /><button className="btn secondary small" disabled={!pick} onClick={() => { if (!itemIds.includes(pick)) setItemIds([...itemIds, pick]); setPick(""); }}>Add material</button></div>
      </Card>
      <ErrorBox error={err} />
      <div className="actions sticky-actions"><button className="btn primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </Page>
  );
}

export function SubmittalDetail() {
  const { id } = useParams();
  const { can } = useApp();
  const { data: d, error, loading, reload } = useApi<Detail>(`/api/submittals/${id}`);
  const [mode, setMode] = useState<"send" | "respond" | null>(null);
  if (loading && !d) return <Loading />;
  if (error || !d) return <Page title="Submittal" back="/submittals"><ErrorBox error={error} /></Page>;
  const manage = can("submittal.manage");
  const done = ["approved", "closed", "cancelled"].includes(d.status);
  const canSend = ["draft", "revise_resubmit", "rejected"].includes(d.status);
  return (
    <Page title={<>{d.number} <Status value={d.status} /> <Ball r={d} /></>}
      subtitle={`${d.projectCode} · ${TYPE_LABEL[d.type]} · ${d.discipline}${d.area ? ` · ${d.area}` : ""} · consultant: ${d.consultantName ?? "—"}${d.subcontractorName ? ` · by ${d.subcontractorName}` : ""}`}
      back="/submittals"
      actions={manage && <>
        {!done && <Link className="btn secondary" to={`/submittals/${d.id}/edit`}>Edit</Link>}
        {canSend && <button className="btn primary" onClick={() => setMode("send")}>{d.status === "draft" ? "Send to consultant" : `Resubmit as revision ${d.currentRevision + 1}`}</button>}
        {d.status === "with_consultant" && <button className="btn primary" onClick={() => setMode("respond")}>Record consultant response</button>}
        {!done && <ActionButton kind="danger" onClick={async () => { const reason = window.prompt("Why is this submittal cancelled?"); if (!reason) return; await post(`/api/submittals/${d.id}/cancel`, { reason }); reload(); }}>Cancel</ActionButton>}
      </>}>
      <h2 className="sub-title">{d.title}</h2>
      {d.overdue && <div className="notice warn">The consultant's reply was due {fmtDate(d.dueDate)}: {d.daysOverdue} days late. Chase the consultant.</div>}
      {d.lateForSite && <div className="notice warn">Site needed this approved by {fmtDate(d.requiredBy)}.</div>}
      {mode === "send" && <SendForm d={d} onDone={() => { setMode(null); reload(); }} onCancel={() => setMode(null)} />}
      {mode === "respond" && <RespondForm d={d} onDone={() => { setMode(null); reload(); }} onCancel={() => setMode(null)} />}
      <Card title="Revisions and consultant responses">
        {!d.revisions.length ? <Empty>Not sent to the consultant yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Rev</th><th>Sent</th><th>Transmittal</th><th>Reply due</th><th>Returned</th><th>Code</th><th>Consultant's comments</th></tr></thead>
            <tbody>{d.revisions.map((r) => (
              <tr key={r.id}>
                <td>{r.revNo}</td><td>{fmtDate(r.submittedDate)}<div className="muted small">{r.submittedByName}</div></td><td>{r.transmittalRef ?? "—"}</td><td>{fmtDate(r.dueDate)}</td>
                <td>{r.returnedDate ? fmtDate(r.returnedDate) : <span className="muted">waiting</span>}{r.inspectionDate && <div className="muted small">inspected {fmtDate(r.inspectionDate)}</div>}</td>
                <td>{r.code ? <><strong>{r.code}</strong> <span className="muted small">{r.codeLabel}</span></> : "—"}</td>
                <td>{r.consultantComments ?? ""}{r.reviewerName && <div className="muted small">{r.reviewerName}</div>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      <Card title="Details">
        <dl className="meta">
          <dt>Approval needed by</dt><dd>{fmtDate(d.requiredBy)}</dd><dt>Spec section</dt><dd>{d.specSection ?? "—"}</dd>
          <dt>Materials covered</dt><dd>{d.items.length ? d.items.map((i) => `${i.code} (${i.description})`).join(", ") : "—"}</dd>
          <dt>Created</dt><dd>{d.creatorName} · {fmtDateTime(d.createdAt)}</dd>
        </dl>
      </Card>
      <History type="submittal" id={d.id} />
    </Page>
  );
}

function SendForm({ d, onDone, onCancel }: { d: Detail; onDone: () => void; onCancel: () => void }) {
  const [submittedDate, setDate] = useState(todayDubai());
  const [transmittalRef, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <Card title={d.status === "draft" ? "Send to the consultant" : `Resubmit as revision ${d.currentRevision + 1}`} className="highlight">
      <div className="form-grid">
        <Field label="Date sent"><input type="date" value={submittedDate} max={todayDubai()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Transmittal no."><input value={transmittalRef} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={d.status === "draft" ? "" : "What changed since the last revision"} /></Field>
      </div>
      <ErrorBox error={err} />
      <div className="actions">
        <ActionButton onClick={async () => { try { await post(`/api/submittals/${d.id}/submit`, { submittedDate, transmittalRef: transmittalRef || null, notes: notes || null, version: d.version }); onDone(); } catch (e) { setErr(e as ApiError); } }}>Send</ActionButton>
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}

function RespondForm({ d, onDone, onCancel }: { d: Detail; onDone: () => void; onCancel: () => void }) {
  const [codeId, setCode] = useState("");
  const [returnedDate, setDate] = useState(todayDubai());
  const [consultantComments, setComments] = useState("");
  const [reviewerName, setReviewer] = useState("");
  const [inspectionDate, setInspection] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  const inspected = d.type === "mockup" || d.type === "sample";
  return (
    <Card title={`Consultant's response to revision ${d.currentRevision}`} className="highlight">
      {!d.codes.length && <div className="notice">This project has no consultant codes yet. Add them on the submittals list (choose the project).</div>}
      <div className="form-grid">
        <Field label="Code"><select value={codeId} onChange={(e) => setCode(e.target.value)}><option value="">Select</option>{d.codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.label}</option>)}</select></Field>
        <Field label="Date returned"><input type="date" value={returnedDate} max={todayDubai()} onChange={(e) => setDate(e.target.value)} /></Field>
        {inspected && <Field label="Inspected on site"><input type="date" value={inspectionDate} max={todayDubai()} onChange={(e) => setInspection(e.target.value)} /></Field>}
        <Field label="Reviewed by"><input value={reviewerName} onChange={(e) => setReviewer(e.target.value)} placeholder="Consultant's engineer" /></Field>
      </div>
      <Field label="Consultant's comments"><textarea rows={3} value={consultantComments} onChange={(e) => setComments(e.target.value)} /></Field>
      <ErrorBox error={err} />
      <div className="actions">
        <ActionButton disabled={!codeId} onClick={async () => {
          try { await post(`/api/submittals/${d.id}/response`, { codeId, returnedDate, consultantComments: consultantComments || null, reviewerName: reviewerName || null, inspectionDate: inspectionDate || null, version: d.version }); onDone(); }
          catch (e) { setErr(e as ApiError); }
        }}>Save response</ActionButton>
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}
