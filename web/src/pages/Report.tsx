import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { get, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Loading, NotTracked, Page, fmtDate, fmtMoney, fmtQty, useApp } from "../ui";

interface ReportData {
  project: { id: string; code: string; name: string; status: string; contractValue: string | null };
  generatedAt: string; asOfLabel: string; currency: string; vatBasis: string; costVisible: boolean;
  summary: Record<string, string | number | null> & { notTrackedReason: string };
  byCostCode: { costCodeId: string; costCode: string; costCodeName: string; committed: string | null; received: string | null; issued: string | null }[];
  materialRequests: { byStatus: { status: string; n: number }[]; openLines: { id: string; mr_id: string; number: string; line_no: number; item_code: string; base_unit: string; required_date: string; requested: string; issued: string; reserved: string; onOrder: string; inTransit: string; uncovered: string; overdue: boolean }[] };
  openPurchaseOrders: { id: string; number: string; status: string; supplier: string; promised_date: string | null; outstanding_lines: number; overdue: boolean }[];
}
type Metric = "committed" | "received" | "issued";
interface Drill { metric: string; total: string; rows: { docId: string; docNumber: string; docType: string; lineNo: string; itemCode: string; costCode: string; qtyBase: string; baseUnit: string; value: string; date: string }[] }

const METRIC_LABEL: Record<Metric, string> = { committed: "Committed (approved POs)", received: "Received into stock", issued: "Issued to work (material cost)" };

export function ProjectReport() {
  const { ref, projectId, can } = useApp();
  const [search] = useSearchParams();
  const [pid, setPid] = useState(search.get("project") ?? projectId ?? ref.projects[0]?.id ?? "");
  const { data, error, loading } = useApi<ReportData>(pid ? `/api/reports/projects/${pid}` : null);
  const [drill, setDrill] = useState<{ metric: Metric; costCodeId?: string } | null>(null);
  useEffect(() => { if (projectId) setPid(projectId); }, [projectId]);

  return (
    <Page title="Project material & procurement report" subtitle={data ? `${data.project.code} — ${data.project.name} · ${data.asOfLabel} · ${data.vatBasis}` : undefined}
      actions={<select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project">{ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>}>
      <ErrorBox error={error} />
      {loading || !data ? <Loading /> : (<>
        {!data.costVisible && <div className="notice">Cost figures are hidden for your role.</div>}
        <div className="kpis">
          {(["committed", "receivedValue", "openCommitment", "issuedCost", "siteStockValue", "pendingApprovalValue"] as const).map((k) => {
            const label = { committed: "Committed", receivedValue: "Received (in stock)", openCommitment: "Open commitment", issuedCost: "Issued to work", siteStockValue: "Held in site store", pendingApprovalValue: `Awaiting approval (${data.summary.pendingApprovalCount} PO)` }[k];
            const metric = ({ committed: "committed", receivedValue: "received", issuedCost: "issued" } as Record<string, Metric>)[k];
            return (
              <div key={k} className="kpi">
                <div className="muted small">{label}</div>
                <div className="kpi-value">{data.summary[k] === null ? "—" : fmtMoney(data.summary[k])}</div>
                {metric && data.costVisible && <button className="linklike small" onClick={() => setDrill({ metric })}>Show source records</button>}
              </div>
            );
          })}
          {(["invoiced", "paid", "labourCost", "subcontractCost", "approvedBudget", "forecastFinalCost"] as const).map((k) => (
            <div key={k} className="kpi missing">
              <div className="muted small">{{ invoiced: "Supplier invoiced", paid: "Paid", labourCost: "Labour cost", subcontractCost: "Subcontract cost", approvedBudget: "Approved budget", forecastFinalCost: "Forecast final cost" }[k]}</div>
              <div className="kpi-value"><NotTracked reason={data.summary.notTrackedReason} /></div>
            </div>
          ))}
        </div>
        <p className="muted small">Definitions: committed = approved PO value less cancelled balances; received = accepted deliveries at PO price (inventory, not yet cost); issued = stock issued to this project's cost codes at moving-average cost (the recognised material cost). A purchase is never counted twice across these stages.</p>

        {drill && <DrillPanel projectId={data.project.id} {...drill} onClose={() => setDrill(null)} />}

        <Card title="By cost code" actions={can("report.export") && data.costVisible && <>
          {(["committed", "received", "issued"] as Metric[]).map((m) => <a key={m} className="btn secondary small" href={`/api/reports/projects/${data.project.id}/export?metric=${m}`}>CSV: {m}</a>)}
        </>}>
          {!data.byCostCode.length ? <Empty>No commitments or issues yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Cost code</th><th className="num">Committed</th><th className="num">Received</th><th className="num">Issued to work</th></tr></thead>
              <tbody>{data.byCostCode.map((c) => (
                <tr key={c.costCodeId}>
                  <td>{c.costCode} <span className="muted">{c.costCodeName}</span></td>
                  {(["committed", "received", "issued"] as Metric[]).map((m) => (
                    <td key={m} className="num">{c[m] === null ? "—" : <button className="linklike" onClick={() => setDrill({ metric: m, costCodeId: c.costCodeId })}>{fmtMoney(c[m])}</button>}</td>
                  ))}
                </tr>))}
              </tbody>
            </table></div>
          )}
        </Card>

        <Card title="Material requests still to be fully issued">
          {!data.materialRequests.openLines.length ? <Empty>All approved requests are fully issued.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Request</th><th>Item</th><th>Required</th><th className="num">Requested</th><th className="num">Issued</th><th className="num">Reserved</th><th className="num">On order</th><th className="num">Uncovered</th></tr></thead>
              <tbody>{data.materialRequests.openLines.map((l) => (
                <tr key={l.id} className={l.overdue ? "late" : ""}>
                  <td><Link to={`/material-requests/${l.mr_id}`}>{l.number}</Link> / {l.line_no}</td><td>{l.item_code}</td>
                  <td>{fmtDate(l.required_date)}{l.overdue ? " (late)" : ""}</td><td className="num">{fmtQty(l.requested)} {l.base_unit}</td>
                  <td className="num">{fmtQty(l.issued)}</td><td className="num">{fmtQty(l.reserved)}</td><td className="num">{fmtQty(l.onOrder)}</td>
                  <td className={`num ${Number(l.uncovered) > 0 ? "warn" : ""}`}>{fmtQty(l.uncovered)}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          <div className="muted small">Requests by status: {data.materialRequests.byStatus.map((s) => `${s.status.replace(/_/g, " ")} ${s.n}`).join(" · ") || "none"}</div>
        </Card>

        <Card title="Purchase orders awaiting delivery">
          {!data.openPurchaseOrders.length ? <Empty>No open purchase orders.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>PO</th><th>Supplier</th><th>Promised</th><th className="num">Lines outstanding</th></tr></thead>
              <tbody>{data.openPurchaseOrders.map((p) => (
                <tr key={p.id} className={p.overdue ? "late" : ""}><td><Link to={`/purchase-orders/${p.id}`}>{p.number}</Link></td><td>{p.supplier}</td>
                  <td>{p.promised_date ? fmtDate(p.promised_date) : <span className="muted">not recorded</span>}{p.overdue ? " (late)" : ""}</td><td className="num">{p.outstanding_lines}</td></tr>))}
              </tbody>
            </table></div>
          )}
        </Card>
        <p className="muted small">Generated {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })} (Dubai time).</p>
      </>)}
    </Page>
  );
}

function DrillPanel({ projectId, metric, costCodeId, onClose }: { projectId: string; metric: Metric; costCodeId?: string; onClose: () => void }) {
  const [data, setData] = useState<Drill | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    setData(null);
    get<Drill>(`/api/reports/projects/${projectId}/drill?metric=${metric}${costCodeId ? `&costCodeId=${costCodeId}` : ""}`).then(setData).catch(setErr);
  }, [projectId, metric, costCodeId]);
  const link = (r: Drill["rows"][number]) =>
    r.docType === "purchase_order" ? `/purchase-orders/${r.docId}` : null;
  return (
    <Card title={`Source records — ${METRIC_LABEL[metric]}${data ? ` · total ${fmtMoney(data.total)}` : ""}`} actions={<button className="btn secondary small" onClick={onClose}>Close</button>} className="highlight">
      <ErrorBox error={err} />
      {!data ? <Loading /> : !data.rows.length ? <Empty>No records.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Document</th><th>Line</th><th>Date</th><th>Item</th><th>Cost code</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
          <tbody>{data.rows.map((r, i) => {
            const to = link(r);
            return (
              <tr key={i}><td>{to ? <Link to={to}>{r.docNumber}</Link> : r.docNumber}</td><td>{r.lineNo}</td><td>{fmtDate(r.date)}</td><td>{r.itemCode}</td><td>{r.costCode}</td>
                <td className="num">{fmtQty(r.qtyBase)} {r.baseUnit}</td><td className="num">{fmtMoney(r.value)}</td></tr>
            );
          })}</tbody>
        </table></div>
      )}
    </Card>
  );
}
