import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { post, put, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Field, Loading, Page, fmtDate, fmtMoney, todayDubai, useApp } from "../ui";
import { pickProject, readTextFile } from "../files";

const KIND_LABEL: Record<string, string> = {
  performance_bond: "Performance bond", advance_payment_guarantee: "Advance payment guarantee", retention_bond: "Retention bond",
  car_insurance: "Contractor's all risks (CAR) insurance", third_party_insurance: "Third party liability insurance", workmen_compensation: "Workmen's compensation",
  professional_indemnity: "Professional indemnity", other: "Other",
};
const STATE: Record<string, [string, string]> = { expired: ["Expired", "red"], expiring: ["Expiring", "amber"], valid: ["Valid", "green"], released: ["Released", "grey"] };

interface ContractRow {
  id: string; contractNo: string; title: string | null; form: string | null; signedDate: string | null; commencementDate: string | null; completionDate: string | null;
  contractValue: string; retentionPct: string; retentionLimitPct: string | null; advancePct: string; ldPerDay: string | null; ldCapPct: string | null;
  defectsLiabilityMonths: number | null; paymentTermsDays: number | null; notes: string | null; version: number; durationDays: number | null; dlpEndDate: string | null;
  boqStatus: "none" | "draft" | "confirmed"; boqConfirmedAt: string | null; boqConfirmedByName: string | null;
}
interface Security { id: string; kind: string; reference: string; issuer: string | null; amount: string | null; issueDate: string | null; expiryDate: string; status: string; releasedDate: string | null; state: string; daysLeft: number | null }
export interface BoqSummary {
  status: string; sourceName: string | null; lines: number; items: number; provisionalSums: string; total: string; difference: string; workDone: string; workDonePct: string;
  sections: { section: string; amount: string; done: string }[]; confirmedAt: string | null; confirmNote: string | null;
}
interface ContractView { project: { id: string; code: string; name: string }; contract: ContractRow | null; securities: Security[]; boq: BoqSummary | null }
interface BudgetView { rows: { costCodeId: string; costCode: string; name: string; budget: string | null; note: string | null; committed: string; remaining: string | null; usedPct: string | null; overBudget: boolean; noBudget: boolean }[]; totalBudget: string; totalCommitted: string; remaining: string }

const pctText = (v: string | null) => (v === null ? "—" : `${Number(v)}%`);

/** The project a page shows: ?project= in the link, else the top-bar project; follows later top-bar changes. */
export function usePageProject() {
  const { ref, projectId: selected } = useApp();
  const [search] = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("project") ?? pickProject(selected, ref.projects));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (selected) setProjectId(selected);
  }, [selected]);
  return [projectId, setProjectId] as const;
}

export function ProjectPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { ref } = useApp();
  return (
    <div className="filters">
      <select aria-label="Project" value={value} onChange={(e) => onChange(e.target.value)}>
        {ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
      </select>
    </div>
  );
}

/** Contract terms, guarantees and insurances, BOQ status and the cost budget for one project. */
export function ContractPage() {
  const { can } = useApp();
  const [projectId, setProjectId] = usePageProject();
  const { data, error, loading, reload } = useApi<ContractView>(projectId ? `/api/projects/${projectId}/contract` : null);
  const [editing, setEditing] = useState(false);
  const manage = can("contract.manage");
  const c = data?.contract ?? null;
  return (
    <Page title="Contract" subtitle="Terms as signed with the client, bonds and insurances, the contract BOQ and the cost budget."
      actions={manage && c && !editing && <button className="btn secondary" onClick={() => setEditing(true)}>Edit terms</button>}>
      <ProjectPicker value={projectId} onChange={(id) => { setProjectId(id); setEditing(false); }} />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (<>
        {!c && !editing && (
          <Card><Empty>No contract recorded for {data.project.code} yet.{manage ? " Record its terms to import the BOQ and track bonds and insurances." : ""}</Empty>
            {manage && <button className="btn primary" onClick={() => setEditing(true)}>Record contract</button>}</Card>
        )}
        {editing && <ContractForm projectId={projectId} current={c} onDone={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />}
        {c && !editing && (<>
          <Card title={<>{c.contractNo}{c.title ? ` — ${c.title}` : ""}</>}>
            <div className="kpis">
              <Kpi label="Contract value" value={fmtMoney(c.contractValue)} />
              <Kpi label="Form of contract" value={c.form ?? "—"} />
              <Kpi label="Commencement → completion" value={`${fmtDate(c.commencementDate)} → ${fmtDate(c.completionDate)}`} note={c.durationDays ? `${c.durationDays} calendar days` : undefined} />
              <Kpi label="Retention" value={pctText(c.retentionPct)} note={c.retentionLimitPct ? `limited to ${Number(c.retentionLimitPct)}% of contract value` : undefined} />
              <Kpi label="Advance payment" value={pctText(c.advancePct)} />
              <Kpi label="Delay damages (LDs)" value={c.ldPerDay ? `${fmtMoney(c.ldPerDay)} / day` : "—"} note={c.ldCapPct ? `capped at ${Number(c.ldCapPct)}%` : undefined} />
              <Kpi label="Defects liability" value={c.defectsLiabilityMonths !== null ? `${c.defectsLiabilityMonths} months` : "—"} note={c.dlpEndDate ? `ends about ${c.dlpEndDate}` : undefined} />
              <Kpi label="Client pays within" value={c.paymentTermsDays !== null ? `${c.paymentTermsDays} days` : "—"} />
            </div>
            {c.notes && <p className="small">{c.notes}</p>}
            <p className="muted small">Signed {fmtDate(c.signedDate)}. Terms are as entered from the signed contract; check the contract itself for conditions.</p>
          </Card>
          <Securities securities={data.securities} projectId={projectId} manage={manage} onChange={reload} />
          <BoqCard boq={data.boq!} contract={c} projectId={projectId} manage={manage} onChange={reload} />
          {can("cost.view") && <Budget projectId={projectId} manage={manage} />}
        </>)}
      </>)}
    </Page>
  );
}

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return <div className="kpi"><div className="muted small">{label}</div><div className="kpi-value">{value}</div>{note && <div className="muted small">{note}</div>}</div>;
}

const FORMS = ["FIDIC 1999 Red Book", "FIDIC 2017 Red Book", "FIDIC 1987 (4th edition)", "FIDIC Yellow Book (design & build)", "Client bespoke", "Subcontract (back-to-back)"];

function ContractForm({ projectId, current, onDone, onCancel }: { projectId: string; current: ContractRow | null; onDone: () => void; onCancel: () => void }) {
  const init = (k: keyof ContractRow) => (current?.[k] === null || current?.[k] === undefined ? "" : String(current[k]));
  const [v, setV] = useState<Record<string, string>>({
    contractNo: init("contractNo"), title: init("title"), form: init("form"), signedDate: init("signedDate"), commencementDate: init("commencementDate"), completionDate: init("completionDate"),
    contractValue: current ? String(Number(current.contractValue)) : "", retentionPct: current ? String(Number(current.retentionPct)) : "", retentionLimitPct: current?.retentionLimitPct ? String(Number(current.retentionLimitPct)) : "",
    advancePct: current ? String(Number(current.advancePct)) : "", ldPerDay: current?.ldPerDay ? String(Number(current.ldPerDay)) : "", ldCapPct: current?.ldCapPct ? String(Number(current.ldCapPct)) : "",
    defectsLiabilityMonths: init("defectsLiabilityMonths"), paymentTermsDays: init("paymentTermsDays"), notes: init("notes"),
  });
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const n = (s: string) => (s.trim() === "" ? null : s.trim());
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await put(`/api/projects/${projectId}/contract`, {
        contractNo: v.contractNo, title: n(v.title), form: n(v.form), signedDate: n(v.signedDate), commencementDate: n(v.commencementDate), completionDate: n(v.completionDate),
        contractValue: v.contractValue.replace(/,/g, ""), retentionPct: v.retentionPct || "0", retentionLimitPct: n(v.retentionLimitPct), advancePct: v.advancePct || "0",
        ldPerDay: n(v.ldPerDay.replace(/,/g, "")), ldCapPct: n(v.ldCapPct), defectsLiabilityMonths: n(v.defectsLiabilityMonths) === null ? null : Number(v.defectsLiabilityMonths),
        paymentTermsDays: n(v.paymentTermsDays) === null ? null : Number(v.paymentTermsDays), notes: n(v.notes), version: current?.version,
      });
      onDone();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Card title={current ? "Edit contract terms" : "Record contract"}>
      <div className="form-grid">
        <Field label="Contract number"><input value={v.contractNo} onChange={set("contractNo")} /></Field>
        <Field label="Title"><input value={v.title} onChange={set("title")} placeholder="e.g. Main works — G+1 villa" /></Field>
        <Field label="Form of contract" hint="As written in the contract"><input list="contract-forms" value={v.form} onChange={set("form")} /></Field>
        <Field label="Contract value (AED, excl. VAT)"><input inputMode="decimal" value={v.contractValue} onChange={set("contractValue")} /></Field>
        <Field label="Signed on"><input type="date" value={v.signedDate} onChange={set("signedDate")} /></Field>
        <Field label="Commencement date"><input type="date" value={v.commencementDate} onChange={set("commencementDate")} /></Field>
        <Field label="Completion date"><input type="date" value={v.completionDate} onChange={set("completionDate")} /></Field>
        <Field label="Retention %"><input inputMode="decimal" value={v.retentionPct} onChange={set("retentionPct")} placeholder="e.g. 10" /></Field>
        <Field label="Retention limit (% of contract value)"><input inputMode="decimal" value={v.retentionLimitPct} onChange={set("retentionLimitPct")} placeholder="e.g. 5, or blank" /></Field>
        <Field label="Advance payment %"><input inputMode="decimal" value={v.advancePct} onChange={set("advancePct")} /></Field>
        <Field label="Delay damages per day (AED)"><input inputMode="decimal" value={v.ldPerDay} onChange={set("ldPerDay")} /></Field>
        <Field label="Delay damages cap %"><input inputMode="decimal" value={v.ldCapPct} onChange={set("ldCapPct")} /></Field>
        <Field label="Defects liability (months)"><input inputMode="numeric" value={v.defectsLiabilityMonths} onChange={set("defectsLiabilityMonths")} /></Field>
        <Field label="Client pays within (days)"><input inputMode="numeric" value={v.paymentTermsDays} onChange={set("paymentTermsDays")} /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} value={v.notes} onChange={set("notes")} placeholder="e.g. Particular conditions that change payment or notice periods" /></Field>
      <datalist id="contract-forms">{FORMS.map((f) => <option key={f} value={f} />)}</datalist>
      <ErrorBox error={err} />
      <div className="actions"><button className="btn primary" disabled={busy || !v.contractNo || !v.contractValue} onClick={save}>{busy ? "Saving…" : "Save contract"}</button><button className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </Card>
  );
}

function Securities({ securities, projectId, manage, onChange }: { securities: Security[]; projectId: string; manage: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ kind: "performance_bond", reference: "", issuer: "", amount: "", issueDate: "", expiryDate: "" });
  const [err, setErr] = useState<ApiError | null>(null);
  const add = async () => {
    setErr(null);
    try {
      await post(`/api/projects/${projectId}/contract/securities`, { ...v, issuer: v.issuer || null, amount: v.amount.replace(/,/g, "") || null, issueDate: v.issueDate || null });
      setAdding(false); setV({ ...v, reference: "", issuer: "", amount: "", issueDate: "", expiryDate: "" }); onChange();
    } catch (e) { setErr(e as ApiError); }
  };
  const release = async (s: Security) => {
    const date = window.prompt(`Date ${s.reference} was released or returned (YYYY-MM-DD)`, todayDubai());
    if (!date) return;
    try { await post(`/api/contract-securities/${s.id}/release`, { releasedDate: date }); onChange(); } catch (e) { setErr(e as ApiError); }
  };
  return (
    <Card title="Bonds, guarantees and insurances" actions={manage && !adding && <button className="btn secondary small" onClick={() => setAdding(true)}>Add</button>}>
      {!securities.length ? <Empty>None recorded. Add the performance bond, advance payment guarantee and insurance policies so their expiry is tracked.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Type</th><th>Number</th><th>Bank / insurer</th><th className="num">Amount</th><th>Expires</th><th>Status</th>{manage && <th />}</tr></thead>
          <tbody>{securities.map((s) => (
            <tr key={s.id}>
              <td>{KIND_LABEL[s.kind] ?? s.kind}</td><td>{s.reference}</td><td>{s.issuer ?? "—"}</td><td className="num">{fmtMoney(s.amount)}</td>
              <td>{fmtDate(s.expiryDate)}{s.state === "expiring" ? <div className="muted small">{s.daysLeft} days left</div> : null}</td>
              <td><span className={`badge ${STATE[s.state][1]}`}>{STATE[s.state][0]}</span>{s.releasedDate ? <div className="muted small">{fmtDate(s.releasedDate)}</div> : null}</td>
              {manage && <td>{s.status === "active" && <button className="btn secondary small" onClick={() => release(s)}>Released</button>}</td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {adding && (
        <div className="progress-form">
          <div className="form-grid">
            <Field label="Type"><select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Guarantee / policy number"><input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
            <Field label="Bank / insurer"><input value={v.issuer} onChange={(e) => setV({ ...v, issuer: e.target.value })} /></Field>
            <Field label="Amount (AED)"><input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
            <Field label="Issued"><input type="date" value={v.issueDate} onChange={(e) => setV({ ...v, issueDate: e.target.value })} /></Field>
            <Field label="Expires"><input type="date" value={v.expiryDate} onChange={(e) => setV({ ...v, expiryDate: e.target.value })} /></Field>
          </div>
          <div className="actions"><button className="btn primary small" disabled={!v.reference || !v.expiryDate} onClick={add}>Save</button><button className="btn secondary small" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      <ErrorBox error={err} />
      <p className="muted small">Shown in amber 30 days before expiry and on the owner's overview.</p>
    </Card>
  );
}

interface ImportResult { ok: boolean; saved: boolean; problems: string[]; lines: number; items: number; headings: number; provisionalSums: number; total: string; contractValue: string; difference: string }

export function BoqImport({ projectId, onSaved }: { projectId: string; onSaved: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean, f = file) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<ImportResult>(`/api/projects/${projectId}/boq/import`, { csv: f.text, fileName: f.name, dryRun });
      setRes(r);
      if (r.saved) { setFile(null); onSaved(); }
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <div className="progress-form">
      <p className="small">In Excel, keep one BOQ sheet with the columns <strong>Ref, Description, Unit, Quantity, Rate, Amount</strong> (and optionally <strong>Cost code</strong>), then <em>File → Save As → CSV UTF-8</em>. Rows with only a description become headings; unit <strong>PS</strong> marks a provisional sum.</p>
      <input type="file" accept=".csv,text/csv" aria-label="BOQ file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const nf = { name: f.name, text: await readTextFile(f) }; setFile(nf); setRes(null); await run(true, nf); }} />
      {busy && <Loading what="Checking" />}
      {res && !res.saved && (res.ok ? (
        <div className="notice ok">
          {res.lines} lines: {res.headings} headings, {res.items} items, {res.provisionalSums} provisional sums. Total {fmtMoney(res.total)}
          {Number(res.difference) !== 0 ? <> — <strong>{fmtMoney(res.difference)}</strong> different from the contract value {fmtMoney(res.contractValue)}.</> : " — matches the contract value."}
          <div className="actions"><button className="btn primary small" disabled={busy} onClick={() => run(false)}>Save as draft BOQ</button></div>
        </div>
      ) : (
        <div className="notice warn"><strong>Nothing was saved. Fix these rows in Excel and choose the file again:</strong><ul>{res.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul>{res.problems.length > 50 && <div>…and {res.problems.length - 50} more</div>}</div>
      ))}
      {res?.saved && <div className="notice ok">Saved {res.lines} lines as the draft BOQ.</div>}
      <ErrorBox error={err} />
    </div>
  );
}

function BoqCard({ boq, contract, projectId, manage, onChange }: { boq: BoqSummary; contract: ContractRow; projectId: string; manage: boolean; onChange: () => void }) {
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  const mismatch = Number(boq.difference) !== 0;
  const confirm = async () => {
    if (!window.confirm("Confirm the contract BOQ? After this it cannot be changed; changes go through variations.")) return;
    setErr(null);
    try { await post(`/api/projects/${projectId}/boq/confirm`, { note: note || null }); onChange(); } catch (e) { setErr(e as ApiError); }
  };
  return (
    <Card title="Contract BOQ" actions={<Link className="btn secondary small" to="/boq">Open BOQ</Link>}>
      {boq.status === "none" ? <Empty>No BOQ imported yet.</Empty> : (
        <div className="kpis">
          <Kpi label="Status" value={boq.status === "confirmed" ? <span className="badge green">Confirmed</span> : <span className="badge amber">Draft</span>}
            note={boq.status === "confirmed" ? `by ${contract.boqConfirmedByName ?? "—"} on ${fmtDate(contract.boqConfirmedAt)}` : boq.sourceName ?? undefined} />
          <Kpi label="BOQ total" value={fmtMoney(boq.total)} note={mismatch ? `${fmtMoney(boq.difference)} vs contract value` : "matches the contract value"} />
          <Kpi label="Provisional sums" value={fmtMoney(boq.provisionalSums)} />
          <Kpi label="Work done (measured)" value={fmtMoney(boq.workDone)} note={`${boq.workDonePct}% of the BOQ`} />
        </div>
      )}
      {boq.confirmNote && <p className="small"><strong>Note at confirmation:</strong> {boq.confirmNote}</p>}
      {boq.sections.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Bill / section</th><th className="num">Amount</th><th className="num">Done</th><th className="num">%</th></tr></thead>
          <tbody>{boq.sections.map((s) => <tr key={s.section}><td>{s.section}</td><td className="num">{fmtMoney(s.amount)}</td><td className="num">{fmtMoney(s.done)}</td><td className="num">{Number(s.amount) ? ((Number(s.done) / Number(s.amount)) * 100).toFixed(1) : "0.0"}%</td></tr>)}</tbody>
        </table></div>
      )}
      {manage && boq.status !== "confirmed" && (<>
        <div className="actions">
          <button className="btn secondary small" onClick={() => setImporting((x) => !x)}>{boq.status === "none" ? "Import BOQ from Excel" : "Replace draft from Excel"}</button>
        </div>
        {importing && <BoqImport projectId={projectId} onSaved={() => { setImporting(false); onChange(); }} />}
        {boq.status === "draft" && (
          <div className="progress-form">
            <p className="small">Check the draft against the signed BOQ, then confirm it. A confirmed BOQ is locked: site measures against it and changes go through variations.</p>
            {mismatch && <Field label="Why the total differs from the contract value"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lump-sum discount of AED 50,000 agreed at signing" /></Field>}
            <div className="actions"><button className="btn primary small" disabled={mismatch && !note.trim()} onClick={confirm}>Confirm contract BOQ</button></div>
          </div>
        )}
      </>)}
      <ErrorBox error={err} />
    </Card>
  );
}

function Budget({ projectId, manage }: { projectId: string; manage: boolean }) {
  const { ref } = useApp();
  const { data, error, reload } = useApi<BudgetView>(`/api/projects/${projectId}/budget`);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const start = () => {
    setValues(Object.fromEntries((data?.rows ?? []).filter((r) => r.budget !== null).map((r) => [r.costCodeId, String(Number(r.budget))])));
    setEditing(true);
  };
  const save = async () => {
    setErr(null);
    try {
      await put(`/api/projects/${projectId}/budget`, { rows: Object.entries(values).filter(([, a]) => a.trim() !== "").map(([costCodeId, amount]) => ({ costCodeId, amount: amount.replace(/,/g, "") })) });
      setEditing(false); reload();
    } catch (e) { setErr(e as ApiError); }
  };
  return (
    <Card title="Cost budget vs purchase commitments" actions={manage && !editing && <button className="btn secondary small" onClick={start}>Set budget</button>}>
      <ErrorBox error={error ?? err} />
      {editing ? (<>
        <div className="table-wrap"><table>
          <thead><tr><th>Cost code</th><th className="num">Budget (AED)</th></tr></thead>
          <tbody>{ref.costCodes.map((c) => (
            <tr key={c.id}><td>{c.code} — {c.name}</td><td className="num"><input inputMode="decimal" aria-label={`Budget ${c.code}`} value={values[c.id] ?? ""} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table></div>
        <div className="actions"><button className="btn primary small" onClick={save}>Save budget</button><button className="btn secondary small" onClick={() => setEditing(false)}>Cancel</button></div>
      </>) : !data ? <Loading /> : !data.rows.length ? <Empty>No budget set and nothing ordered yet.</Empty> : (<>
        <div className="table-wrap"><table>
          <thead><tr><th>Cost code</th><th className="num">Budget</th><th className="num">Committed (POs)</th><th className="num">Remaining</th><th className="num">Used</th></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.costCodeId}>
              <td>{r.costCode} — {r.name}</td><td className="num">{r.budget === null ? <span className="badge amber">no budget</span> : fmtMoney(r.budget)}</td>
              <td className="num">{fmtMoney(r.committed)}</td><td className={`num ${r.overBudget ? "warn" : ""}`}>{fmtMoney(r.remaining)}</td><td className="num">{r.usedPct === null ? "—" : `${r.usedPct}%`}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><th>Total</th><th className="num">{fmtMoney(data.totalBudget)}</th><th className="num">{fmtMoney(data.totalCommitted)}</th><th className="num">{fmtMoney(data.remaining)}</th><th /></tr></tfoot>
        </table></div>
        <p className="muted small">Committed = approved purchase orders. Subcontract and labour costs join this table with the next modules.</p>
      </>)}
    </Card>
  );
}
