import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get, post, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Loading, Page, fmtDate, fmtMoney, fmtQty, todayDubai, useApp } from "../ui";
import { BoqImport, ProjectPicker, usePageProject, type BoqSummary } from "./Contract";

interface Line {
  id: string; lineNo: number; kind: "heading" | "item" | "provisional_sum"; ref: string | null; description: string; unit: string | null; qty: string | null; section: string | null; costCode: string | null;
  rate: string | null; amount: string | null; qtyToDate: string | null; pctDone: string | null; overMeasured: boolean; valueDone: string | null; lastMeasured: { asOfDate: string; remark: string | null } | null;
}
interface BoqView { status: "none" | "draft" | "confirmed"; contractNo: string | null; showRates: boolean; lines: Line[]; summary: BoqSummary | null }
interface SaveResult { ok: boolean; saved: number; problems: string[]; warnings: string[] }
interface Hist { asOfDate: string; qtyToDate: string; remark: string | null; byName: string; recordedAt: string }

/** The contract BOQ with quantities done to date. Site engineers record measurements here. */
export function BoqPage() {
  const { can } = useApp();
  const [projectId, setProjectId] = usePageProject();
  const { data, error, loading, reload } = useApi<BoqView>(projectId ? `/api/projects/${projectId}/boq` : null);
  const [q, setQ] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [asOf, setAsOf] = useState(todayDubai());
  const [edits, setEdits] = useState<Record<string, { qty: string; remark: string }>>({});
  const [result, setResult] = useState<SaveResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState<{ line: Line; rows: Hist[] } | null>(null);

  const lines = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    if (!t) return data.lines;
    return data.lines.filter((l) => l.kind === "heading" || `${l.ref ?? ""} ${l.description} ${l.section ?? ""}`.toLowerCase().includes(t));
  }, [data, q]);
  const canMeasure = can("site.progress") && data?.status === "confirmed";
  const changed = Object.entries(edits).filter(([id, e]) => {
    const l = data?.lines.find((x) => x.id === id);
    return l && e.qty.trim() !== "" && Number(e.qty) !== Number(l.qtyToDate ?? 0);
  });
  const save = async () => {
    setErr(null); setResult(null);
    try {
      const r = await post<SaveResult>(`/api/projects/${projectId}/boq/measurements`, { asOfDate: asOf, rows: changed.map(([boqLineId, e]) => ({ boqLineId, qtyToDate: e.qty, remark: e.remark || null })) });
      setResult(r);
      if (r.ok) { setEdits({}); setMeasuring(false); reload(); }
    } catch (e) { setErr(e as ApiError); }
  };
  const showHistory = async (l: Line) => setHistory({ line: l, rows: await get<Hist[]>(`/api/boq-lines/${l.id}/measurements`) });
  const cols = data?.showRates ? 9 : 6;

  return (
    <Page title="Bill of quantities" subtitle="The contract BOQ and the quantity done to date on each item, measured on site."
      actions={<>
        {canMeasure && !measuring && <button className="btn primary" onClick={() => { setMeasuring(true); setResult(null); }}>Record quantities done</button>}
        {can("contract.view") && <Link className="btn secondary" to="/contract">Contract</Link>}
      </>}>
      <ProjectPicker value={projectId} onChange={(id) => { setProjectId(id); setMeasuring(false); setEdits({}); }} />
      <ErrorBox error={error ?? err} />
      {loading && !data ? <Loading /> : data && (<>
        {data.status === "none" && (
          <Card><Empty>No BOQ for this project yet.{can("contract.manage") ? " Record the contract first, then import its BOQ from Excel." : ""}</Empty>
            {can("contract.manage") && <Link className="btn primary" to="/contract">Go to contract</Link>}</Card>
        )}
        {data.status === "draft" && (
          <div className="notice">Draft BOQ, not yet confirmed against the signed contract. Quantities can be measured once it is confirmed.
            {can("contract.manage") && <> <button className="linklike" onClick={() => setImporting((x) => !x)}>Replace from Excel</button> · <Link to="/contract">Confirm on the contract page</Link></>}</div>
        )}
        {importing && <BoqImport projectId={projectId} onSaved={() => { setImporting(false); reload(); }} />}
        {data.summary && (
          <div className="kpis">
            <div className="kpi"><div className="muted small">BOQ total</div><div className="kpi-value">{fmtMoney(data.summary.total)}</div><div className="muted small">{data.summary.items} items · {fmtMoney(data.summary.provisionalSums)} provisional sums</div></div>
            <div className="kpi"><div className="muted small">Work done to date</div><div className="kpi-value">{fmtMoney(data.summary.workDone)}</div><div className="muted small">{data.summary.workDonePct}% of the BOQ by value</div></div>
          </div>
        )}
        {measuring && (
          <div className="notice ok measure-bar">
            <label>Quantities as at <input type="date" value={asOf} max={todayDubai()} onChange={(e) => setAsOf(e.target.value)} /></label>
            <span>Enter the <strong>total quantity done to date</strong> on each item you measured (not this week's quantity). {changed.length} changed.</span>
            <div className="actions"><button className="btn primary small" disabled={!changed.length} onClick={save}>Save {changed.length || ""} measurement{changed.length === 1 ? "" : "s"}</button><button className="btn secondary small" onClick={() => { setMeasuring(false); setEdits({}); }}>Cancel</button></div>
          </div>
        )}
        {result && !result.ok && <div className="notice warn"><strong>Nothing was saved:</strong><ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
        {result?.ok && <div className="notice ok">Saved {result.saved} measurement{result.saved === 1 ? "" : "s"}.</div>}
        {result?.warnings.length ? <div className="notice"><ul>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : null}
        {data.lines.length > 0 && (
          <Card>
            <div className="filters"><input placeholder="Search ref or description" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="table-wrap"><table className="boq">
              <thead><tr>
                <th>Ref</th><th>Description</th><th>Unit</th><th className="num">BOQ qty</th>
                {data.showRates && <><th className="num">Rate</th><th className="num">Amount</th></>}
                <th className="num">Done to date</th><th className="num">%</th>{data.showRates && <th className="num">Value done</th>}
              </tr></thead>
              <tbody>{lines.map((l) => l.kind === "heading" ? (
                <tr key={l.id} className="boq-heading"><td>{l.ref}</td><td colSpan={cols - 1}>{l.description}</td></tr>
              ) : (
                <tr key={l.id}>
                  <td>{l.ref}</td>
                  <td>{l.description}{l.costCode && <span className="muted small"> · {l.costCode}</span>}</td>
                  <td>{l.unit}</td>
                  <td className="num">{l.kind === "item" ? fmtQty(l.qty) : "—"}</td>
                  {data.showRates && <><td className="num">{l.rate !== null ? fmtQty(l.rate) : "—"}</td><td className="num">{fmtMoney(l.amount)}</td></>}
                  <td className="num">
                    {l.kind !== "item" ? <span className="muted small">provisional</span> : measuring ? (
                      <div className="measure-input">
                        <input inputMode="decimal" aria-label={`Quantity to date ${l.ref ?? l.lineNo}`} placeholder={String(Number(l.qtyToDate ?? 0))}
                          value={edits[l.id]?.qty ?? ""} onChange={(e) => setEdits({ ...edits, [l.id]: { qty: e.target.value, remark: edits[l.id]?.remark ?? "" } })} />
                        {edits[l.id]?.qty && Number(edits[l.id].qty) < Number(l.qtyToDate ?? 0) && (
                          <input aria-label="Reason for the lower quantity" placeholder="Why lower?" value={edits[l.id].remark} onChange={(e) => setEdits({ ...edits, [l.id]: { ...edits[l.id], remark: e.target.value } })} />
                        )}
                      </div>
                    ) : (
                      <button className="linklike" title="Measurement history" onClick={() => showHistory(l)}>{fmtQty(l.qtyToDate)}</button>
                    )}
                  </td>
                  <td className={`num ${l.overMeasured ? "warn" : ""}`}>{l.pctDone !== null ? `${l.pctDone}%` : ""}</td>
                  {data.showRates && <td className="num">{l.valueDone !== null ? fmtMoney(l.valueDone) : ""}</td>}
                </tr>
              ))}</tbody>
            </table></div>
            {!data.showRates && <p className="muted small">Rates and amounts are hidden for your role.</p>}
          </Card>
        )}
        {history && (
          <Card title={<>Measurements of {history.line.ref ?? `line ${history.line.lineNo}`}: {history.line.description}</>} actions={<button className="btn secondary small" onClick={() => setHistory(null)}>Close</button>}>
            {!history.rows.length ? <Empty>Not measured yet.</Empty> : (
              <table><thead><tr><th>As at</th><th className="num">Qty to date</th><th>By</th><th>Remark</th></tr></thead>
                <tbody>{history.rows.map((h, i) => <tr key={i}><td>{fmtDate(h.asOfDate)}</td><td className="num">{fmtQty(h.qtyToDate)} {history.line.unit}</td><td>{h.byName}</td><td>{h.remark ?? ""}</td></tr>)}</tbody></table>
            )}
          </Card>
        )}
      </>)}
    </Page>
  );
}
