import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, newIdempotencyKey, post, useApi, type ApiError } from "../api";
import { Card, Empty, ErrorBox, Field, Loading, Page, fmtDate, fmtMoney, fmtQty, todayDubai, useApp } from "../ui";
import type { MrDetailData } from "./MaterialRequests";

interface StockRow {
  itemId: string; itemCode: string; description: string; baseUnit: string; locationId: string; locationCode: string; locationType: string;
  available: string; reserved: string; free: string; quarantine: string; rejected: string; inTransit: string; discrepancy: string;
  belowReorder: boolean; avgUnitCost: string | null; availableValue: string | null;
}

export function StockPage() {
  const { ref, projectId, can } = useApp();
  const [search] = useSearchParams();
  const [locationId, setLocationId] = useState("");
  const [text, setText] = useState("");
  const itemFilter = search.get("item");
  const qs = new URLSearchParams({ ...(locationId ? { locationId } : {}), ...(itemFilter ? { itemId: itemFilter } : {}) });
  const { data, error, loading } = useApi<StockRow[]>(`/api/stock?${qs}`);
  const rows = useMemo(() => {
    const f = text.toLowerCase();
    return (data ?? []).filter((r) => !f || r.itemCode.toLowerCase().includes(f) || r.description.toLowerCase().includes(f))
      .filter((r) => !projectId || r.locationType !== "site_store" || ref.locations.find((l) => l.id === r.locationId)?.projectId === projectId);
  }, [data, text, projectId, ref.locations]);
  const showCost = rows.some((r) => r.avgUnitCost !== null);
  return (
    <Page title="Stock position" subtitle="Physical stock by location and status. Free = available − reserved. Rejected and in-transit stock cannot be issued."
      actions={<>{can("stock.issue") && <Link className="btn primary" to="/issues/new">Issue stock</Link>}{can("stock.transfer") && <Link className="btn secondary" to="/transfers/new">New transfer</Link>}</>}>
      <div className="filters">
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Location">
          <option value="">All locations I can see</option>
          {ref.locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
        </select>
        <input placeholder="Filter by item code or description" value={text} onChange={(e) => setText(e.target.value)} />
        {itemFilter && <Link to="/stock" className="btn secondary small">Clear item filter</Link>}
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !rows.length ? <Empty>No stock found for these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Location</th><th>Item</th><th className="num">Available</th><th className="num">Reserved</th><th className="num">Free</th><th className="num">Rejected</th><th className="num">In transit</th><th className="num">Discrepancy</th>{showCost && <th className="num">Avg cost</th>}{showCost && <th className="num">Value</th>}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.locationId}-${r.itemId}`} className={r.belowReorder ? "low" : ""}>
                <td>{r.locationCode}</td>
                <td><Link to={`/stock/card/${r.itemId}`}>{r.itemCode}</Link><div className="muted small">{r.description}{r.belowReorder ? " · below reorder level" : ""}</div></td>
                <td className="num">{fmtQty(r.available)} {r.baseUnit}</td><td className="num">{fmtQty(r.reserved)}</td><td className="num"><strong>{fmtQty(r.free)}</strong></td>
                <td className="num">{fmtQty(r.rejected)}</td><td className="num">{fmtQty(r.inTransit)}</td><td className="num">{fmtQty(r.discrepancy)}</td>
                {showCost && <td className="num">{fmtMoney(r.avgUnitCost)}</td>}{showCost && <td className="num">{fmtMoney(r.availableValue)}</td>}
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

interface CardRow { seq: number; date: string; type: string; location: string; status: string; qtyDelta: string; balanceInBucket: string; sourceNumber: string; sourceType: string; project: string | null; costCode: string | null; postedBy: string; note: string | null; unitCost: string | null; valueDelta: string | null }

export function StockCard() {
  const { itemId } = useParams();
  const { can } = useApp();
  const { data, error, loading } = useApi<{ item: { code: string; description: string; baseUnit: string }; rows: CardRow[] }>(`/api/stock/card/${itemId}`);
  if (loading) return <Loading />;
  if (error || !data) return <Page title="Stock card" back="/stock"><ErrorBox error={error} /></Page>;
  const showCost = data.rows.some((r) => r.unitCost !== null);
  return (
    <Page title={`Stock card — ${data.item.code}`} subtitle={`${data.item.description} · quantities in ${data.item.baseUnit}. The ledger is append-only; corrections appear as new rows.`} back="/stock"
      actions={can("report.export") && <a className="btn secondary" href={`/api/stock/card/${itemId}/export`}>Export CSV</a>}>
      <Card>
        {!data.rows.length ? <Empty>No movements yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Movement</th><th>Location</th><th>Status</th><th className="num">Qty</th><th className="num">Balance</th><th>Document</th><th>Project / cost code</th>{showCost && <th className="num">Value</th>}<th>By</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.seq}>
                <td>{fmtDate(r.date)}</td><td>{r.type.replace(/_/g, " ")}</td><td>{r.location}</td><td>{r.status.replace(/_/g, " ")}</td>
                <td className={`num ${Number(r.qtyDelta) < 0 ? "neg" : ""}`}>{Number(r.qtyDelta) > 0 ? "+" : ""}{fmtQty(r.qtyDelta)}</td>
                <td className="num">{fmtQty(r.balanceInBucket)}</td><td>{r.sourceNumber}</td><td>{[r.project, r.costCode].filter(Boolean).join(" · ") || "—"}</td>
                {showCost && <td className="num">{fmtMoney(r.valueDelta)}</td>}<td>{r.postedBy}{r.note && <div className="muted small">{r.note}</div>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

interface MrRow { id: string; number: string; projectCode: string; purpose: string | null }

/** Issue stock against an approved material request (the request is the authorisation). */
export function IssueForm() {
  const { ref, projectId } = useApp();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [mrId, setMrId] = useState(search.get("mr") ?? "");
  const { data: mrs } = useApi<MrRow[]>(`/api/material-requests?status=approved&limit=200${projectId ? `&projectId=${projectId}` : ""}`);
  const [mr, setMr] = useState<MrDetailData | null>(null);
  const [locationId, setLocationId] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<StockRow[]>([]);
  const [key, setKey] = useState(newIdempotencyKey);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMr(null); setQty({});
    if (mrId) get<MrDetailData>(`/api/material-requests/${mrId}`).then(setMr).catch(setErr);
  }, [mrId]);
  useEffect(() => {
    if (locationId) get<StockRow[]>(`/api/stock?locationId=${locationId}`).then(setStock).catch(setErr);
    else setStock([]);
  }, [locationId]);

  const locations = ref.locations.filter((l) => l.type === "warehouse" || (mr && l.projectId === mr.projectId));
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([mrLineId, v]) => ({ mrLineId, qty: v }));
      const res = await post<{ issue: { id: string; number: string } }>("/api/stock-issues", { idempotencyKey: key, locationId, issuedTo, issueDate: todayDubai(), lines });
      setKey(newIdempotencyKey());
      alert(`Posted ${res.issue.number}`);
      navigate(`/material-requests/${mrId}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <Page title="Issue stock to work" subtitle="Issues are made against an approved material request and charged to its project and cost code." back="/stock">
      <Card>
        <div className="form-grid">
          <Field label="Approved material request">
            <select value={mrId} onChange={(e) => setMrId(e.target.value)}>
              <option value="">Select request</option>
              {mrs?.map((m) => <option key={m.id} value={m.id}>{m.number} · {m.projectCode} · {m.purpose ?? ""}</option>)}
            </select>
          </Field>
          <Field label="Issue from">
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!mr}>
              <option value="">Select store</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select>
          </Field>
          <Field label="Issued to (crew / person)"><input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. Drywall crew — foreman name" /></Field>
        </div>
      </Card>
      {mr && locationId && (
        <Card title={`${mr.number} — lines`}>
          <div className="table-wrap"><table>
            <thead><tr><th>Item</th><th className="num">Still to issue</th><th className="num">Reserved here for this request</th><th className="num">Free here</th><th>Issue now</th></tr></thead>
            <tbody>{mr.lines.map((l) => {
              const remaining = Number(l.fulfilment.requested) - Number(l.fulfilment.issued);
              const s = stock.find((x) => x.itemId === l.itemId);
              const loc = ref.locations.find((x) => x.id === locationId);
              const ownHere = l.reservations.filter((r) => r.status === "active" && r.location_code === loc?.code).reduce((a, r) => a + Number(r.qty) - Number(r.qty_consumed), 0);
              return (
                <tr key={l.id}>
                  <td><strong>{l.itemCode}</strong><div className="muted small">{l.itemDescription}</div></td>
                  <td className="num">{fmtQty(remaining)} {l.baseUnit}</td>
                  <td className="num">{fmtQty(ownHere)}</td>
                  <td className="num">{fmtQty(s?.free ?? 0)}</td>
                  <td><input inputMode="decimal" disabled={remaining <= 0} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={`Quantity for ${l.itemCode}`} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <p className="muted small">You can issue up to (reserved here for this request + free here). Delivery to a site store is not consumption — only issues count as project material cost.</p>
          <ErrorBox error={err} />
          <div className="actions"><button className="btn primary" disabled={busy || !issuedTo} onClick={submit}>{busy ? "Posting…" : "Post issue"}</button></div>
        </Card>
      )}
      {!mr && <ErrorBox error={err} />}
    </Page>
  );
}
