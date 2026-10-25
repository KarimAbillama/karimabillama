import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, newIdempotencyKey, post, useApi, type ApiError } from "../api";
import { ActionButton, Card, Empty, ErrorBox, Field, Loading, Page, Status, fmtDate, fmtQty, todayDubai, useApp } from "../ui";
import { History } from "./History";

interface TransferRow { id: string; number: string; status: string; dispatchDate: string; receivedDate: string | null; fromCode: string; toCode: string; dispatchedByName: string; openDiscrepancies: number }
interface TransferDetailData {
  id: string; number: string; status: string; dispatchDate: string; receivedDate: string | null; fromCode: string; fromName: string; toCode: string; toName: string;
  vehicleRef: string | null; notes: string | null; canReceive: boolean;
  lines: { id: string; itemCode: string; itemDescription: string; baseUnit: string; qtyDispatched: string; qtyReceived: string | null; qtyDiscrepancy: string | null; discrepancyStatus: string; discrepancyNote: string | null; mrNumber: string | null }[];
}
interface StockRow { itemId: string; itemCode: string; description: string; baseUnit: string; free: string; reserved: string }

export function TransferList() {
  const { can } = useApp();
  const { data, error, loading } = useApi<TransferRow[]>("/api/transfers?limit=100");
  return (
    <Page title="Stock transfers" subtitle="Dispatch puts goods in transit; the destination gains stock only when it confirms receipt." actions={can("stock.transfer") && <Link className="btn primary" to="/transfers/new">New transfer</Link>}>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No transfers yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>From</th><th>To</th><th>Status</th><th>Dispatched</th><th>Received</th><th>By</th></tr></thead>
            <tbody>{data.map((t) => (
              <tr key={t.id}>
                <td><Link to={`/transfers/${t.id}`}>{t.number}</Link></td><td>{t.fromCode}</td><td>{t.toCode}</td>
                <td><Status value={t.status} />{t.openDiscrepancies > 0 && <span className="badge red">open discrepancy</span>}</td>
                <td>{fmtDate(t.dispatchDate)}</td><td>{fmtDate(t.receivedDate)}</td><td>{t.dispatchedByName}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

export function TransferForm() {
  const { ref } = useApp();
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vehicleRef, setVehicleRef] = useState("");
  const [stock, setStock] = useState<StockRow[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [key] = useState(newIdempotencyKey);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQty({});
    if (from) get<StockRow[]>(`/api/stock?locationId=${from}`).then((s) => setStock(s.filter((x) => Number(x.free) > 0))).catch(setErr);
  }, [from]);
  const locs = ref.locations.filter((l) => l.type !== "transit");
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, qty: v }));
      const res = await post<{ transfer: { id: string } }>("/api/transfers", { idempotencyKey: key, fromLocationId: from, toLocationId: to, dispatchDate: todayDubai(), vehicleRef: vehicleRef || null, lines });
      navigate(`/transfers/${res.transfer.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Page title="Dispatch a transfer" subtitle="Only free (unreserved) stock can be moved here. Reserved stock moves with its request from the request screen in a later release." back="/transfers">
      <Card>
        <div className="form-grid">
          <Field label="From"><select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></Field>
          <Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select</option>{locs.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></Field>
          <Field label="Vehicle / driver ref."><input value={vehicleRef} onChange={(e) => setVehicleRef(e.target.value)} /></Field>
        </div>
      </Card>
      {from && (
        <Card title="Items to dispatch">
          {!stock.length ? <Empty>No free stock at this location.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th className="num">Free</th><th>Dispatch qty</th></tr></thead>
              <tbody>{stock.map((s) => (
                <tr key={s.itemId}><td><strong>{s.itemCode}</strong><div className="muted small">{s.description}</div></td><td className="num">{fmtQty(s.free)} {s.baseUnit}</td>
                  <td><input inputMode="decimal" value={qty[s.itemId] ?? ""} onChange={(e) => setQty({ ...qty, [s.itemId]: e.target.value })} aria-label={`Quantity ${s.itemCode}`} /></td></tr>))}
              </tbody>
            </table></div>
          )}
          <ErrorBox error={err} />
          <div className="actions"><button className="btn primary" disabled={busy || !to} onClick={submit}>{busy ? "Posting…" : "Dispatch"}</button></div>
        </Card>
      )}
    </Page>
  );
}

export function TransferDetail() {
  const { id } = useParams();
  const { can } = useApp();
  const { data: t, error, loading, reload } = useApi<TransferDetailData>(`/api/transfers/${id}`);
  const [recv, setRecv] = useState<Record<string, { qty: string; note: string }>>({});
  const [key] = useState(newIdempotencyKey);
  const [err, setErr] = useState<ApiError | null>(null);
  if (loading && !t) return <Loading />;
  if (error || !t) return <Page title="Transfer" back="/transfers"><ErrorBox error={error} /></Page>;
  const receiving = t.status === "in_transit" && t.canReceive;
  return (
    <Page title={<>{t.number} <Status value={t.status} /></>} subtitle={`${t.fromCode} → ${t.toCode} · dispatched ${fmtDate(t.dispatchDate)}${t.vehicleRef ? ` · ${t.vehicleRef}` : ""}`} back="/transfers">
      <Card title={receiving ? "Confirm what arrived" : "Lines"}>
        <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>For request</th><th className="num">Dispatched</th><th className="num">Received</th><th className="num">Short</th><th>Discrepancy</th>{receiving && <th>Received qty / note</th>}</tr></thead>
          <tbody>{t.lines.map((l) => (
            <tr key={l.id}>
              <td><strong>{l.itemCode}</strong><div className="muted small">{l.itemDescription}</div></td><td>{l.mrNumber ?? "—"}</td>
              <td className="num">{fmtQty(l.qtyDispatched)} {l.baseUnit}</td><td className="num">{fmtQty(l.qtyReceived)}</td><td className="num">{fmtQty(l.qtyDiscrepancy)}</td>
              <td><Status value={l.discrepancyStatus} />{l.discrepancyNote && <div className="muted small">{l.discrepancyNote}</div>}
                {l.discrepancyStatus === "open" && can("stock.adjust") && (
                  <div className="actions">
                    <ActionButton kind="secondary" onClick={async () => { const n = window.prompt("Where were the goods found?"); if (!n) return; await post(`/api/transfer-lines/${l.id}/resolve`, { resolution: "found", note: n }); reload(); }}>Found</ActionButton>
                    <ActionButton kind="danger" onClick={async () => { const n = window.prompt("Reason for write-off (inventory loss)?"); if (!n) return; await post(`/api/transfer-lines/${l.id}/resolve`, { resolution: "written_off", note: n }); reload(); }}>Write off</ActionButton>
                  </div>
                )}
              </td>
              {receiving && <td>
                <input inputMode="decimal" placeholder={l.qtyDispatched} value={recv[l.id]?.qty ?? ""} onChange={(e) => setRecv({ ...recv, [l.id]: { qty: e.target.value, note: recv[l.id]?.note ?? "" } })} aria-label="Received quantity" />
                <input placeholder="Note if short" value={recv[l.id]?.note ?? ""} onChange={(e) => setRecv({ ...recv, [l.id]: { qty: recv[l.id]?.qty ?? "", note: e.target.value } })} aria-label="Shortage note" />
              </td>}
            </tr>))}
          </tbody>
        </table></div>
        {receiving && <>
          <ErrorBox error={err} />
          <div className="actions">
            <ActionButton onClick={async () => {
              setErr(null);
              try {
                await post(`/api/transfers/${t.id}/receive`, {
                  idempotencyKey: key, receivedDate: todayDubai(),
                  lines: t.lines.map((l) => ({ lineId: l.id, qtyReceived: recv[l.id]?.qty || l.qtyDispatched, note: recv[l.id]?.note || null })),
                });
                reload();
              } catch (e) { setErr(e as ApiError); }
            }}>Confirm receipt</ActionButton>
          </div>
          <p className="muted small">Leave a quantity blank if everything arrived. A shortage needs a note and is tracked as a discrepancy until resolved.</p>
        </>}
      </Card>
      <History type="stock_transfer" id={t.id} />
    </Page>
  );
}
