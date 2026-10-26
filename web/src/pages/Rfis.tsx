import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, post, put, useApi, type ApiError } from "../api";
import { ActionButton, Card, Empty, ErrorBox, Field, Loading, Page, Status, fmtDate, fmtDateTime, todayDubai, useApp } from "../ui";
import { History } from "./History";

const DISCIPLINES = ["architectural", "structural", "civil", "mechanical", "electrical", "plumbing", "fire", "landscape", "other"];
const IMPACT_LABEL: Record<string, string> = { none: "No", possible: "Possible", yes: "Yes" };

interface Row {
  id: string; number: string; projectId: string; projectCode: string; discipline: string; subject: string; status: string; priority: string; round: number;
  issueDate: string | null; responseDueDate: string | null; blockedActivity: string | null; costImpact: string; timeImpact: string;
  ballInCourt: "consultant" | "edge" | null; daysOpen: number | null; daysOverdue: number; overdue: boolean; owner: string | null;
  drawing: { id: string; number: string; revision: string } | null; originatorName: string;
}
interface Detail extends Row {
  version: number; question: string; location: string | null; boqRef: string | null; drawingRevisionId: string | null; originatorId: string; originatorCompanyId: string | null;
  originatorCompanyName: string | null; assigneeId: string | null; assigneeName: string | null; recipientCompanyId: string | null; recipientName: string | null; transmittalRef: string | null;
  closedDate: string | null; closureNote: string | null; createdAt: string; drawingWarning: string | null; potentialVariation: boolean;
  drawingInfo: { drawingId: string; number: string; title: string; revision: string; state: string; constructionRevision: string | null } | null;
  responses: { id: string; round: number; responseDate: string; responderName: string | null; reference: string | null; response: string; recordedByName: string }[];
  events: { id: number; fromStatus: string | null; toStatus: string; note: string | null; byName: string; at: string }[];
}
interface DrawingRow { id: string; number: string; title: string; latest: { id: string; revision: string } | null; construction: { id: string; revision: string } | null }
interface DrawingDetail { id: string; number: string; revisions: { id: string; revision: string; state: string; purpose: string; issueDate: string }[] }

function Holder({ r }: { r: Pick<Row, "ballInCourt" | "daysOverdue" | "owner" | "daysOpen"> }) {
  if (r.ballInCourt === "consultant") return <span className={`badge ${r.daysOverdue ? "red" : "blue"}`}>{r.owner} · {r.daysOpen} d{r.daysOverdue ? ` · ${r.daysOverdue} d late` : ""}</span>;
  if (r.ballInCourt === "edge") return <span className="badge amber">{r.owner ?? "EDGE"}</span>;
  return <span className="badge grey">Done</span>;
}

export function RfiList() {
  const { ref, projectId: selected, can } = useApp();
  const [search] = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("project") ?? selected ?? "");
  const [ball, setBall] = useState(search.get("ball") ?? "");
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState("");
  const qs = new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(ball ? { ball } : {}), ...(status ? { status } : {}), ...(overdue ? { overdue: "true" } : {}), ...(q ? { q } : {}) });
  const { data, error, loading } = useApi<Row[]>(`/api/rfis?${qs}`);
  return (
    <Page title="RFIs" subtitle="Questions to the consultant: who holds each one, how long it has been open, and what it holds up on site."
      actions={can("rfi.create") && <Link className="btn primary" to={`/rfis/new${projectId ? `?project=${projectId}` : ""}`}>New RFI</Link>}>
      <div className="filters">
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All my projects</option>{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
        <select aria-label="Who holds it" value={ball} onChange={(e) => setBall(e.target.value)}><option value="">Anyone</option><option value="consultant">With the consultant</option><option value="edge">EDGE to act</option></select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["draft", "internal_review", "returned", "issued", "responded", "closed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <input placeholder="Search number, subject or question" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label>
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No RFIs match these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>Project</th><th>Subject</th><th>Status</th><th>Who holds it</th><th>Reply due</th><th>Holds up</th><th>Impact</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className={r.overdue ? "late" : ""}>
                <td><Link to={`/rfis/${r.id}`}>{r.number}</Link>{r.priority === "urgent" || r.priority === "high" ? <span className="badge red">{r.priority}</span> : null}</td>
                <td>{r.projectCode}</td>
                <td>{r.subject}<div className="muted small">{r.discipline}{r.drawing ? ` · ${r.drawing.number} rev ${r.drawing.revision}` : ""}</div></td>
                <td><Status value={r.status} />{r.round > 1 && <span className="muted small"> round {r.round}</span>}</td>
                <td><Holder r={r} /></td>
                <td className={r.overdue ? "warn" : ""}>{fmtDate(r.responseDueDate)}</td>
                <td className="small">{r.blockedActivity ?? "—"}</td>
                <td className="small">{r.costImpact !== "none" ? `Cost: ${IMPACT_LABEL[r.costImpact]}` : ""}{r.costImpact !== "none" && r.timeImpact !== "none" ? " · " : ""}{r.timeImpact !== "none" ? `Time: ${IMPACT_LABEL[r.timeImpact]}` : ""}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

export function RfiForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { ref, projectId: selected } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState({
    projectId: search.get("project") ?? selected ?? ref.projects[0]?.id ?? "", discipline: "architectural", subject: "", question: "", location: "", drawingId: "", drawingRevisionId: "",
    boqRef: "", blockedActivity: "", originatorCompanyId: "", assigneeId: "", priority: "normal", costImpact: "none", timeImpact: "none", responseDueDate: "",
  });
  const [version, setVersion] = useState<number>();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: dwgs } = useApi<DrawingRow[]>(f.projectId ? `/api/drawings?projectId=${f.projectId}` : null);
  const { data: dwg } = useApi<DrawingDetail>(f.drawingId ? `/api/drawings/${f.drawingId}` : null);
  const { data: people } = useApi<{ id: string; fullName: string }[]>(f.projectId ? `/api/projects/${f.projectId}/rfi-assignees` : null);
  useEffect(() => {
    if (!id) return;
    get<Detail>(`/api/rfis/${id}`).then((d) => {
      setF({ projectId: d.projectId, discipline: d.discipline, subject: d.subject, question: d.question, location: d.location ?? "", drawingId: d.drawingInfo?.drawingId ?? "",
        drawingRevisionId: d.drawingRevisionId ?? "", boqRef: d.boqRef ?? "", blockedActivity: d.blockedActivity ?? "", originatorCompanyId: d.originatorCompanyId ?? "",
        assigneeId: d.assigneeId ?? "", priority: d.priority, costImpact: d.costImpact, timeImpact: d.timeImpact, responseDueDate: d.responseDueDate ?? "" });
      setVersion(d.version);
    }).catch(setErr);
  }, [id]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const chosenRev = dwg?.revisions.find((r) => r.id === f.drawingRevisionId);
  const save = async (review: boolean) => {
    setBusy(true); setErr(null);
    try {
      const body = { discipline: f.discipline, subject: f.subject, question: f.question, location: f.location || null, drawingRevisionId: f.drawingRevisionId || null, boqRef: f.boqRef || null,
        blockedActivity: f.blockedActivity || null, originatorCompanyId: f.originatorCompanyId || null, assigneeId: f.assigneeId || null, priority: f.priority,
        costImpact: f.costImpact, timeImpact: f.timeImpact, responseDueDate: f.responseDueDate || null };
      const saved = id ? await put<{ id: string }>(`/api/rfis/${id}`, { ...body, version }) : await post<{ id: string }>("/api/rfis", { ...body, projectId: f.projectId });
      if (review) await post(`/api/rfis/${saved.id}/review`);
      navigate(`/rfis/${saved.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Page title={id ? "Edit RFI" : "New RFI"} back={id ? `/rfis/${id}` : "/rfis"}>
      <Card>
        <div className="form-grid">
          <Field label="Project"><select value={f.projectId} disabled={!!id} onChange={(e) => setF({ ...f, projectId: e.target.value, drawingId: "", drawingRevisionId: "", assigneeId: "" })}>{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Discipline"><select value={f.discipline} onChange={set("discipline")}>{DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
          <Field label="Priority"><select value={f.priority} onChange={set("priority")}>{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          <Field label="Location"><input value={f.location} onChange={set("location")} placeholder="e.g. Level 2, corridor C" /></Field>
        </div>
        <Field label="Subject"><input value={f.subject} onChange={set("subject")} placeholder="e.g. Door D-12 head height" /></Field>
        <Field label="Question to the consultant"><textarea rows={4} value={f.question} onChange={set("question")} placeholder="State the conflict or missing information, and propose a solution if you have one." /></Field>
      </Card>
      <Card title="References">
        <div className="form-grid">
          <Field label="Drawing"><select value={f.drawingId} onChange={(e) => setF({ ...f, drawingId: e.target.value, drawingRevisionId: "" })}><option value="">None</option>{dwgs?.map((d) => <option key={d.id} value={d.id}>{d.number} — {d.title}</option>)}</select></Field>
          <Field label="Revision"><select value={f.drawingRevisionId} disabled={!dwg} onChange={set("drawingRevisionId")}><option value="">Select</option>{dwg?.revisions.map((r) => <option key={r.id} value={r.id}>{r.revision} · {r.purpose.replace(/_/g, " ")} · {r.state === "current_construction" ? "CURRENT for construction" : r.state === "superseded" ? "superseded" : "latest"}</option>)}</select></Field>
          <Field label="BOQ / spec reference"><input value={f.boqRef} onChange={set("boqRef")} /></Field>
          <Field label="Site work held up by this"><input value={f.blockedActivity} onChange={set("blockedActivity")} placeholder="e.g. Door frame installation L2" /></Field>
        </div>
        {chosenRev?.state === "superseded" && <div className="notice warn">Revision {chosenRev.revision} of {dwg?.number} is superseded. Check the current construction revision before raising this RFI.</div>}
      </Card>
      <Card title="Responsibility and impact">
        <div className="form-grid">
          <Field label="Raised for (subcontractor)"><select value={f.originatorCompanyId} onChange={set("originatorCompanyId")}><option value="">EDGE</option>{ref.partners.filter((p) => p.isSubcontractor).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Responsible at EDGE"><select value={f.assigneeId} onChange={set("assigneeId")}><option value="">Me</option>{people?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
          <Field label="Possible cost impact"><select value={f.costImpact} onChange={set("costImpact")}>{Object.entries(IMPACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Possible time impact"><select value={f.timeImpact} onChange={set("timeImpact")}>{Object.entries(IMPACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Answer needed by" hint="Leave empty to use the project's standard reply period"><input type="date" value={f.responseDueDate} onChange={set("responseDueDate")} /></Field>
        </div>
      </Card>
      <ErrorBox error={err} />
      <div className="actions sticky-actions">
        <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={busy || !f.subject.trim() || !f.question.trim()} onClick={() => save(true)}>{busy ? "Saving…" : "Send for internal review"}</button>
      </div>
    </Page>
  );
}

export function RfiDetail() {
  const { id } = useParams();
  const { me, can } = useApp();
  const { data: d, error, loading, reload } = useApi<Detail>(`/api/rfis/${id}`);
  const [mode, setMode] = useState<"issue" | "respond" | "close" | "return" | null>(null);
  if (loading && !d) return <Loading />;
  if (error || !d) return <Page title="RFI" back="/rfis"><ErrorBox error={error} /></Page>;
  const issuer = can("rfi.issue");
  const editable = ["draft", "returned", "internal_review"].includes(d.status) && (d.originatorId === me.userId || issuer);
  return (
    <Page title={<>{d.number} <Status value={d.status} /> <Holder r={d} /></>}
      subtitle={`${d.projectCode} · ${d.discipline}${d.location ? ` · ${d.location}` : ""} · raised by ${d.originatorName}${d.originatorCompanyName ? ` for ${d.originatorCompanyName}` : ""} · to ${d.recipientName ?? "consultant"}`}
      back="/rfis"
      actions={<>
        {editable && <Link className="btn secondary" to={`/rfis/${d.id}/edit`}>Edit</Link>}
        {["draft", "returned"].includes(d.status) && can("rfi.create") && <ActionButton onClick={async () => { await post(`/api/rfis/${d.id}/review`); reload(); }}>Send for internal review</ActionButton>}
        {issuer && ["draft", "internal_review"].includes(d.status) && <button className="btn primary" onClick={() => setMode("issue")}>Issue to consultant</button>}
        {issuer && d.status === "internal_review" && <button className="btn secondary" onClick={() => setMode("return")}>Return to originator</button>}
        {issuer && d.status === "issued" && <button className="btn primary" onClick={() => setMode("respond")}>Record consultant's answer</button>}
        {issuer && d.status === "responded" && <><button className="btn primary" onClick={() => setMode("close")}>Close RFI</button><button className="btn secondary" onClick={() => setMode("issue")}>Answer not enough: re-issue</button></>}
        {!["closed", "cancelled"].includes(d.status) && can("rfi.create") && <ActionButton kind="danger" onClick={async () => { const reason = window.prompt("Why is this RFI cancelled?"); if (!reason) return; await post(`/api/rfis/${d.id}/cancel`, { reason }); reload(); }}>Cancel</ActionButton>}
      </>}>
      <h2 className="sub-title">{d.subject}</h2>
      {d.overdue && <div className="notice warn">The consultant's answer was due {fmtDate(d.responseDueDate)}: {d.daysOverdue} days late.{d.blockedActivity ? ` Site work held up: ${d.blockedActivity}.` : ""}</div>}
      {d.drawingWarning && <div className="notice warn">{d.drawingWarning}</div>}
      {d.status === "responded" && d.potentialVariation && <div className="notice">This RFI may have a cost or time impact. The consultant's answer is not a variation instruction: raise a variation separately if the work changes.</div>}
      {mode && <ActionForm d={d} mode={mode} onDone={() => { setMode(null); reload(); }} onCancel={() => setMode(null)} />}
      <div className="report-grid">
        <Card title="Question">
          <p className="pre">{d.question}</p>
          <dl className="meta">
            <dt>Drawing</dt><dd>{d.drawingInfo ? <Link to={`/drawings/${d.drawingInfo.drawingId}`}>{d.drawingInfo.number} rev {d.drawingInfo.revision}</Link> : "—"}</dd>
            <dt>BOQ / spec</dt><dd>{d.boqRef ?? "—"}</dd><dt>Holds up</dt><dd>{d.blockedActivity ?? "—"}</dd>
            <dt>Priority</dt><dd>{d.priority}</dd><dt>Cost / time impact</dt><dd>{IMPACT_LABEL[d.costImpact]} / {IMPACT_LABEL[d.timeImpact]}</dd>
            <dt>Responsible</dt><dd>{d.assigneeName ?? d.originatorName}</dd>
            <dt>Issued</dt><dd>{fmtDate(d.issueDate)}{d.transmittalRef ? ` · ${d.transmittalRef}` : ""}</dd><dt>Answer due</dt><dd>{fmtDate(d.responseDueDate)}</dd>
          </dl>
        </Card>
        <Card title="Consultant's answer">
          {!d.responses.length ? <Empty>No answer recorded yet.</Empty> : d.responses.map((r) => (
            <div key={r.id} className="response">
              <div className="muted small">Round {r.round} · {fmtDate(r.responseDate)}{r.responderName ? ` · ${r.responderName}` : ""}{r.reference ? ` · ref. ${r.reference}` : ""} · recorded by {r.recordedByName}</div>
              <p className="pre">{r.response}</p>
            </div>
          ))}
          {d.status === "closed" && <div className="closure"><strong>Closed by EDGE {fmtDate(d.closedDate)}:</strong> {d.closureNote}</div>}
        </Card>
      </div>
      <Card title="Steps">
        <ul className="history">{d.events.map((e) => <li key={e.id}><span className="muted">{fmtDateTime(e.at)}</span> · <strong>{e.byName}</strong> · {e.fromStatus ? `${e.fromStatus.replace(/_/g, " ")} → ` : ""}{e.toStatus.replace(/_/g, " ")}{e.note ? <span className="muted"> · {e.note}</span> : null}</li>)}</ul>
      </Card>
      <History type="rfi" id={d.id} />
    </Page>
  );
}

function ActionForm({ d, mode, onDone, onCancel }: { d: Detail; mode: "issue" | "respond" | "close" | "return"; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayDubai());
  const [text, setText] = useState("");
  const [ref1, setRef1] = useState("");
  const [ref2, setRef2] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  const reissue = mode === "issue" && d.status === "responded";
  const title = { issue: reissue ? `Re-issue as round ${d.round + 1}` : "Issue to the consultant", respond: "Consultant's answer", close: "Close the RFI (EDGE's internal closure)", return: "Return to the originator" }[mode];
  const submit = async () => {
    setErr(null);
    try {
      if (mode === "issue") await post(`/api/rfis/${d.id}/issue`, { issueDate: date, transmittalRef: ref1 || null, responseDueDate: ref2 || null, note: text || null });
      if (mode === "respond") await post(`/api/rfis/${d.id}/response`, { responseDate: date, response: text, responderName: ref1 || null, reference: ref2 || null });
      if (mode === "close") await post(`/api/rfis/${d.id}/close`, { closedDate: date, closureNote: text });
      if (mode === "return") await post(`/api/rfis/${d.id}/return`, { comment: text });
      onDone();
    } catch (e) { setErr(e as ApiError); }
  };
  return (
    <Card title={title} className="highlight">
      <div className="form-grid">
        {mode !== "return" && <Field label={mode === "issue" ? "Issue date" : mode === "respond" ? "Date answered" : "Closure date"}><input type="date" value={date} max={todayDubai()} onChange={(e) => setDate(e.target.value)} /></Field>}
        {mode === "issue" && <><Field label="Transmittal no."><input value={ref1} onChange={(e) => setRef1(e.target.value)} /></Field>
          <Field label="Answer due" hint="Empty = project's standard period"><input type="date" value={ref2} onChange={(e) => setRef2(e.target.value)} /></Field></>}
        {mode === "respond" && <><Field label="Answered by"><input value={ref1} onChange={(e) => setRef1(e.target.value)} placeholder="Consultant's engineer" /></Field>
          <Field label="Consultant's reference"><input value={ref2} onChange={(e) => setRef2(e.target.value)} /></Field></>}
      </div>
      <Field label={{ issue: reissue ? "Why the answer is not enough (required)" : "Note (optional)", respond: "The answer, as received", close: "What was done with the answer (required)", return: "What to change (required)" }[mode]}>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {mode === "close" && d.potentialVariation && <p className="muted small">Closing does not create or approve a variation. If the answer changes the work, raise a variation separately.</p>}
      <ErrorBox error={err} />
      <div className="actions"><ActionButton onClick={submit}>Save</ActionButton><button className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </Card>
  );
}
