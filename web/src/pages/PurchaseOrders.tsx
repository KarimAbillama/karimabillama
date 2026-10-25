import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, newIdempotencyKey, post, put, useApi, type ApiError } from "../api";
import type { ApprovalRequest } from "../types";
import { ActionButton, ApprovalHistory, Card, Empty, ErrorBox, Field, Loading, Page, Status, addDays, fmtDate, fmtMoney, fmtQty, todayDubai, useApp } from "../ui";
import { DecisionPanel } from "./Approvals";
import { History } from "./History";
import { ItemSelect, useItems, type MrDetailData } from "./MaterialRequests";

interface PoRow { id: string; number: string; status: string; revision: number; projectCode: string; supplierName: string; subtotal: string | null; promisedDate: string | null; requiredDate: string | null }
interface PoLine {
  id: string; lineNo: number; itemId: string; mrLineId: string | null; costCodeId: string; unitCode: string; qty: string; qtyBase: string; unitPrice: string | null;
  vatCode: string; lineNet: string | null; lineVat: string | null; qtyCancelledBase: string; itemCode: string; itemDescription: string; baseUnit: string; costCode: string;
  acceptedBase: string; rejectedBase: string; outstandingBase: string; mrNumber: string | null; mrId: string | null;
}
interface PoDetailData {
  id: string; number: string; status: string; revision: number; version: number; projectId: string; projectCode: string; projectName: string; supplierId: string;
  supplierName: string; supplierTrn: string | null; deliveryLocationId: string; deliveryLocationCode: string; deliveryLocationName: string; requiredDate: string | null;
  promisedDate: string | null; paymentTerms: string | null; supplierQuoteRef: string | null; notes: string | null; subtotal: string | null; vatAmount: string | null;
  total: string | null; createdBy: string; creatorName: string; pricesVisible: boolean; lines: PoLine[];
  receipts: { id: string; number: string; receivedDate: string; deliveryNoteRef: string | null; receivedByName: string; locationCode: string }[];
  approvals: ApprovalRequest[];
}
interface Supplier { id: string; code: string; name: string; paymentTerms: string | null }

export function PoList() {
  const { projectId, can } = useApp();
  const [status, setStatus] = useState("");
  const qs = new URLSearchParams({ limit: "100", ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) });
  const { data, error, loading } = useApi<PoRow[]>(`/api/purchase-orders?${qs}`);
  const today = todayDubai();
  return (
    <Page title="Purchase orders" actions={can("po.create") && <Link className="btn primary" to="/purchase-orders/new">New purchase order</Link>}>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["draft", "pending_approval", "approved", "partially_received", "received", "rejected", "closed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? <Empty>No purchase orders match these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>Project</th><th>Supplier</th><th>Status</th><th>Promised</th><th className="num">Value excl. VAT</th></tr></thead>
            <tbody>{data.map((r) => {
              const late = ["approved", "partially_received"].includes(r.status) && r.promisedDate && r.promisedDate < today;
              return (
                <tr key={r.id}>
                  <td><Link to={`/purchase-orders/${r.id}`}>{r.number}</Link>{r.revision > 0 && <span className="muted"> rev {r.revision}</span>}</td>
                  <td>{r.projectCode}</td><td>{r.supplierName}</td><td><Status value={r.status} /></td>
                  <td className={late ? "warn" : ""}>{fmtDate(r.promisedDate)}{late ? " (late)" : ""}</td>
                  <td className="num">{r.subtotal === null ? <span className="muted">hidden</span> : fmtMoney(r.subtotal)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

interface LineDraft { itemId: string; mrLineId: string | null; mrLabel?: string; costCodeId: string; unitCode: string; qty: string; unitPrice: string; vatCode: string }

export function PoForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const fromMr = search.get("mr");
  const { ref, projectId: selected } = useApp();
  const navigate = useNavigate();
  const items = useItems();
  const { data: suppliers } = useApi<Supplier[]>("/api/suppliers");
  const [projectId, setProjectId] = useState(selected ?? ref.projects[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [supplierQuoteRef, setSupplierQuoteRef] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [version, setVersion] = useState<number | undefined>();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultVat = ref.vatCodes[0]?.code ?? "SR";

  useEffect(() => {
    if (id) {
      get<PoDetailData>(`/api/purchase-orders/${id}`).then((p) => {
        setProjectId(p.projectId); setSupplierId(p.supplierId); setDeliveryLocationId(p.deliveryLocationId); setRequiredDate(p.requiredDate ?? "");
        setPromisedDate(p.promisedDate ?? ""); setPaymentTerms(p.paymentTerms ?? ""); setSupplierQuoteRef(p.supplierQuoteRef ?? ""); setNotes(p.notes ?? ""); setVersion(p.version);
        setLines(p.lines.map((l) => ({ itemId: l.itemId, mrLineId: l.mrLineId, mrLabel: l.mrNumber ?? undefined, costCodeId: l.costCodeId, unitCode: l.unitCode, qty: l.qty, unitPrice: l.unitPrice ?? "", vatCode: l.vatCode })));
      }).catch(setErr);
    } else if (fromMr) {
      get<MrDetailData>(`/api/material-requests/${fromMr}`).then((m) => {
        setProjectId(m.projectId);
        setRequiredDate(m.requiredDate);
        setLines(m.lines.filter((l) => Number(l.fulfilment.uncovered) > 0).map((l) => ({
          itemId: l.itemId, mrLineId: l.id, mrLabel: `${m.number} line ${l.lineNo}`, costCodeId: l.costCodeId, unitCode: l.baseUnit, qty: l.fulfilment.uncovered, unitPrice: "", vatCode: defaultVat,
        })));
      }).catch(setErr);
    } else {
      setLines([{ itemId: "", mrLineId: null, costCodeId: "", unitCode: "", qty: "", unitPrice: "", vatCode: defaultVat }]);
    }
  }, [id, fromMr, defaultVat]);

  const locations = ref.locations.filter((l) => l.type === "warehouse" || (l.type === "site_store" && l.projectId === projectId));
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const net = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const vat = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * Number(ref.vatCodes.find((v) => v.code === l.vatCode)?.rate ?? 0) / 100, 0);

  const save = async (submit: boolean) => {
    setBusy(true); setErr(null);
    try {
      const body = {
        supplierId, deliveryLocationId, requiredDate: requiredDate || null, promisedDate: promisedDate || null, paymentTerms: paymentTerms || null,
        supplierQuoteRef: supplierQuoteRef || null, notes: notes || null,
        lines: lines.map(({ mrLabel: _m, ...l }) => l),
      };
      const saved = id
        ? await put<{ id: string; version: number }>(`/api/purchase-orders/${id}`, { ...body, version })
        : await post<{ id: string; version: number }>("/api/purchase-orders", { ...body, projectId });
      if (submit) await post(`/api/purchase-orders/${saved.id}/submit`, { version: saved.version });
      navigate(`/purchase-orders/${saved.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <Page title={id ? "Edit purchase order" : "New purchase order"} subtitle={fromMr ? "Prefilled with the uncovered quantities of the material request" : undefined} back={id ? `/purchase-orders/${id}` : "/purchase-orders"}>
      <Card>
        <div className="form-grid">
          <Field label="Project">
            <select value={projectId} disabled={!!id || !!fromMr} onChange={(e) => { setProjectId(e.target.value); setDeliveryLocationId(""); }}>
              {ref.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier">
            <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); const s = suppliers?.find((x) => x.id === e.target.value); if (s?.paymentTerms && !paymentTerms) setPaymentTerms(s.paymentTerms); }} required>
              <option value="">Select supplier</option>
              {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Deliver to">
            <select value={deliveryLocationId} onChange={(e) => setDeliveryLocationId(e.target.value)} required>
              <option value="">Select location</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select>
          </Field>
          <Field label="Required on site"><input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></Field>
          <Field label="Supplier promised date"><input type="date" value={promisedDate} min={todayDubai()} onChange={(e) => setPromisedDate(e.target.value)} /></Field>
          <Field label="Payment terms"><input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></Field>
          <Field label="Supplier quotation ref."><input value={supplierQuoteRef} onChange={(e) => setSupplierQuoteRef(e.target.value)} /></Field>
          <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Lines" actions={!fromMr && <button className="btn secondary small" onClick={() => setLines((l) => [...l, { itemId: "", mrLineId: null, costCodeId: "", unitCode: "", qty: "", unitPrice: "", vatCode: defaultVat }])}>Add line</button>}>
        {!ref.vatVerified && <div className="notice">VAT codes and rates are placeholders until EDGE's accountant confirms them. Choose the treatment per line.</div>}
        <div className="line-editor">
          {lines.map((l, i) => {
            const item = items.find((x) => x.id === l.itemId);
            const unitOptions = item ? [item.baseUnit, ...(item.purchaseUnit && item.purchaseUnit !== item.baseUnit ? [item.purchaseUnit] : []), ...item.conversions.map((c) => c.unitCode)] : [];
            return (
              <div key={i} className="line-row">
                <span className="line-no">{i + 1}</span>
                {l.mrLineId ? <div className="fixed-item"><strong>{item?.code}</strong> <span className="muted small">{item?.description}<br />for {l.mrLabel}</span></div>
                  : <ItemSelect items={items} value={l.itemId} onChange={(v) => { const it = items.find((x) => x.id === v); setLine(i, { itemId: v, unitCode: it?.purchaseUnit ?? it?.baseUnit ?? "" }); }} />}
                <Field label="Qty"><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
                <Field label="Unit">
                  <select value={l.unitCode} onChange={(e) => setLine(i, { unitCode: e.target.value })}>
                    {[...new Set(unitOptions.length ? unitOptions : [l.unitCode])].map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Unit price (AED, excl. VAT)"><input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></Field>
                <Field label="VAT">
                  <select value={l.vatCode} onChange={(e) => setLine(i, { vatCode: e.target.value })}>
                    {ref.vatCodes.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.label} ({v.rate}%)</option>)}
                  </select>
                </Field>
                <Field label="Cost code">
                  <select value={l.costCodeId} disabled={!!l.mrLineId} onChange={(e) => setLine(i, { costCodeId: e.target.value })}>
                    <option value="">Select</option>
                    {ref.costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                  </select>
                </Field>
                <button className="btn secondary small" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
              </div>
            );
          })}
        </div>
        <div className="totals">Net {fmtMoney(net)} · VAT {fmtMoney(vat)} · Total {fmtMoney(net + vat)} <span className="muted small">(final figures are calculated on the server)</span></div>
      </Card>
      <ErrorBox error={err} />
      <div className="actions sticky-actions">
        <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={busy || !lines.length} onClick={() => save(true)}>{busy ? "Saving…" : "Save & submit for approval"}</button>
      </div>
    </Page>
  );
}

export function PoDetail() {
  const { id } = useParams();
  const { me, can } = useApp();
  const { data: po, error, loading, reload } = useApi<PoDetailData>(`/api/purchase-orders/${id}`);
  const [receiving, setReceiving] = useState(false);
  if (loading && !po) return <Loading />;
  if (error) return <Page title="Purchase order" back="/purchase-orders"><ErrorBox error={error} /></Page>;
  if (!po) return null;
  const receivable = ["approved", "partially_received"].includes(po.status) && can("stock.receive");
  const late = ["approved", "partially_received"].includes(po.status) && po.promisedDate && po.promisedDate < todayDubai();
  return (
    <Page
      title={<>{po.number} <Status value={po.status} />{po.revision > 0 && <span className="muted small"> revision {po.revision}</span>}</>}
      subtitle={`${po.projectCode} · ${po.supplierName}${po.supplierTrn ? ` (TRN ${po.supplierTrn})` : ""} · Deliver to ${po.deliveryLocationCode} · Raised by ${po.creatorName}`}
      back="/purchase-orders"
      actions={<>
        {po.status === "draft" && can("po.create") && <Link className="btn secondary" to={`/purchase-orders/${po.id}/edit`}>Edit</Link>}
        {po.status === "draft" && can("po.create") && <ActionButton onClick={async () => { await post(`/api/purchase-orders/${po.id}/submit`, { version: po.version }); reload(); }}>Submit for approval</ActionButton>}
        {["rejected", "pending_approval", "approved"].includes(po.status) && !po.receipts.length && can("po.create") && (
          <ActionButton kind="secondary" onClick={async () => {
            const reason = window.prompt("Why does this PO need to change? It will need approval again.");
            if (!reason) return;
            await post(`/api/purchase-orders/${po.id}/revise`, { reason }); reload();
          }}>Revise</ActionButton>
        )}
        {receivable && !receiving && <button className="btn primary" onClick={() => setReceiving(true)}>Receive delivery</button>}
        {["approved", "partially_received", "draft", "pending_approval", "rejected"].includes(po.status) && can("po.create") && (
          <ActionButton kind="danger" onClick={async () => {
            const reason = window.prompt(po.receipts.length ? "Reason for short-closing (outstanding balance will be cancelled)?" : "Reason for cancelling this PO?");
            if (!reason) return;
            await post(`/api/purchase-orders/${po.id}/short-close`, { reason }); reload();
          }}>{po.receipts.length ? "Short-close" : "Cancel PO"}</ActionButton>
        )}
      </>}
    >
      {late && <div className="notice warn">Delivery is late: promised {fmtDate(po.promisedDate)}.</div>}
      {po.status === "pending_approval" && po.createdBy !== me.userId && <DecisionPanel docId={po.id} onDone={reload} />}
      {receiving && <ReceiveForm po={po} onDone={() => { setReceiving(false); reload(); }} onCancel={() => setReceiving(false)} />}
      <Card title="Lines">
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Item</th><th>For request</th><th className="num">Ordered</th>{po.pricesVisible && <th className="num">Unit price</th>}{po.pricesVisible && <th className="num">Net</th>}<th className="num">Accepted</th><th className="num">Rejected</th><th className="num">Cancelled</th><th className="num">Outstanding</th></tr></thead>
          <tbody>{po.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td><strong>{l.itemCode}</strong><div className="muted small">{l.itemDescription} · {l.costCode} · VAT {l.vatCode}</div></td>
              <td>{l.mrId ? <Link to={`/material-requests/${l.mrId}`}>{l.mrNumber}</Link> : "—"}</td>
              <td className="num">{fmtQty(l.qty)} {l.unitCode}{l.unitCode !== l.baseUnit && <div className="muted small">= {fmtQty(l.qtyBase)} {l.baseUnit}</div>}</td>
              {po.pricesVisible && <td className="num">{fmtMoney(l.unitPrice)}</td>}
              {po.pricesVisible && <td className="num">{fmtMoney(l.lineNet)}</td>}
              <td className="num">{fmtQty(l.acceptedBase)} {l.baseUnit}</td>
              <td className="num">{fmtQty(l.rejectedBase)}</td>
              <td className="num">{fmtQty(l.qtyCancelledBase)}</td>
              <td className={`num ${Number(l.outstandingBase) > 0 ? "warn" : ""}`}>{fmtQty(l.outstandingBase)}</td>
            </tr>))}
          </tbody>
        </table></div>
        {po.pricesVisible
          ? <div className="totals">Net {fmtMoney(po.subtotal)} · VAT {fmtMoney(po.vatAmount)} · <strong>Total {fmtMoney(po.total)}</strong></div>
          : <p className="muted small">Prices are hidden for your role.</p>}
        <dl className="meta">
          <dt>Required</dt><dd>{fmtDate(po.requiredDate)}</dd><dt>Promised</dt><dd>{fmtDate(po.promisedDate)}</dd>
          <dt>Payment terms</dt><dd>{po.paymentTerms ?? "—"}</dd><dt>Quotation ref.</dt><dd>{po.supplierQuoteRef ?? "—"}</dd>
          {po.notes && <><dt>Notes</dt><dd>{po.notes}</dd></>}
        </dl>
      </Card>
      <Card title="Deliveries received">
        {!po.receipts.length ? <Empty>No deliveries yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Delivery note</th><th>Location</th><th>Received by</th></tr></thead>
            <tbody>{po.receipts.map((r) => <tr key={r.id}><td>{r.number}</td><td>{fmtDate(r.receivedDate)}</td><td>{r.deliveryNoteRef ?? "—"}</td><td>{r.locationCode}</td><td>{r.receivedByName}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="Approval history"><ApprovalHistory approvals={po.approvals} /></Card>
      <History type="purchase_order" id={po.id} />
    </Page>
  );
}

function ReceiveForm({ po, onDone, onCancel }: { po: PoDetailData; onDone: () => void; onCancel: () => void }) {
  const open = po.lines.filter((l) => Number(l.outstandingBase) > 0);
  const [key] = useState(newIdempotencyKey);
  const [dn, setDn] = useState("");
  const [date, setDate] = useState(todayDubai());
  const [rows, setRows] = useState(open.map((l) => ({ poLineId: l.id, qtyReceived: "", qtyRejected: "", rejectionReason: "" })));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const lines = rows.filter((r) => Number(r.qtyReceived) > 0).map((r) => ({ poLineId: r.poLineId, qtyReceived: r.qtyReceived, qtyRejected: r.qtyRejected || "0", rejectionReason: r.rejectionReason || null }));
      // the same key is reused if the user presses Post again after a network error, so the receipt cannot be duplicated
      await post(`/api/purchase-orders/${po.id}/receipts`, { idempotencyKey: key, deliveryNoteRef: dn || null, receivedDate: date, lines });
      onDone();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <Card title={`Receive delivery into ${po.deliveryLocationCode}`} className="highlight">
      <div className="form-grid">
        <Field label="Supplier delivery note no."><input value={dn} onChange={(e) => setDn(e.target.value)} /></Field>
        <Field label="Received on"><input type="date" value={date} max={todayDubai()} min={addDays(todayDubai(), -30)} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="line-editor">
        {open.map((l, i) => {
          const factor = Number(l.qtyBase) / Number(l.qty);
          return (
            <div key={l.id} className="line-row">
              <span className="line-no">{l.lineNo}</span>
              <div className="fixed-item"><strong>{l.itemCode}</strong> <span className="muted small">{l.itemDescription}<br />Outstanding {fmtQty(Number(l.outstandingBase) / factor)} {l.unitCode}</span></div>
              <Field label={`Delivered (${l.unitCode})`}><input inputMode="decimal" value={rows[i].qtyReceived} onChange={(e) => set(i, { qtyReceived: e.target.value })} /></Field>
              <Field label={`Rejected (${l.unitCode})`}><input inputMode="decimal" value={rows[i].qtyRejected} onChange={(e) => set(i, { qtyRejected: e.target.value })} /></Field>
              <Field label="Rejection reason"><input value={rows[i].rejectionReason} onChange={(e) => set(i, { rejectionReason: e.target.value })} disabled={!(Number(rows[i].qtyRejected) > 0)} /></Field>
            </div>
          );
        })}
      </div>
      <p className="muted small">Accepted quantity becomes available stock (reserved for the linked request). Rejected quantity is held as "rejected" until returned to the supplier.</p>
      <ErrorBox error={err} />
      <div className="actions">
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Posting…" : "Post receipt"}</button>
      </div>
    </Card>
  );
}
